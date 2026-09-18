import { Router } from "express";
import { db, playersTable, roomsTable } from "@workspace/db";
import { and, count, desc, eq } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../lib/auth";
import {
  generateDoorPosition,
  normalizeRoomGeometry,
  roomManager,
  validateRoomShape,
  validateRoomWalls,
  type Room,
} from "../lib/room-manager";

const router = Router();

const roomFields = {
  id: roomsTable.id,
  ownerId: roomsTable.ownerId,
  name: roomsTable.name,
  tiles: roomsTable.tiles,
  walls: roomsTable.walls,
  doorPosition: roomsTable.doorPosition,
  floorTextureId: roomsTable.floorTextureId,
  wallTextureId: roomsTable.wallTextureId,
  isPublic: roomsTable.isPublic,
  hasPassword: roomsTable.password,
  createdAt: roomsTable.createdAt,
};

function serializeRoom(room: { hasPassword: string | null; [key: string]: unknown }) {
  return {
    ...room,
    hasPassword: room.hasPassword !== null,
  };
}

const MAX_ROOMS_PER_PLAYER = 10;

function validateRoomInput(data: unknown):
  | {
      ok: true;
      name: string;
      tiles: Room["tiles"];
      walls: Room["walls"];
      doorPosition: Room["doorPosition"];
      floorTextureId: string;
      wallTextureId: string;
      isPublic: boolean;
      password: string | null;
    }
  | { ok: false; message: string } {
  if (!data || typeof data !== "object") {
    return { ok: false, message: "Datos de sala inválidos" };
  }

  const input = data as Record<string, unknown>;
  if (
    typeof input.name !== "string" ||
    input.name.trim().length === 0 ||
    input.name.length > 50
  ) {
    return { ok: false, message: "El nombre debe tener entre 1 y 50 caracteres" };
  }
  if (
    typeof input.floorTextureId !== "string" ||
    input.floorTextureId.length > 30 ||
    typeof input.wallTextureId !== "string" ||
    input.wallTextureId.length > 30
  ) {
    return { ok: false, message: "Las texturas deben tener como máximo 30 caracteres" };
  }
  if (typeof input.isPublic !== "boolean") {
    return { ok: false, message: "isPublic debe ser booleano" };
  }
  if (
    input.password !== undefined &&
    (typeof input.password !== "string" || input.password.length > 100)
  ) {
    return { ok: false, message: "La contraseña debe tener como máximo 100 caracteres" };
  }

  const shape = validateRoomShape(input.tiles);
  if (!shape.ok) return { ok: false, message: shape.message };
  const wallShape = validateRoomWalls(input.walls);
  if (!wallShape.ok) return { ok: false, message: wallShape.message };
  const geometry = normalizeRoomGeometry(shape.tiles, wallShape.walls);
  const password =
    typeof input.password === "string" && input.password.length > 0
      ? input.password
      : null;

  if (!input.isPublic && !password) {
    return { ok: false, message: "Las salas privadas requieren una contraseña" };
  }

  return {
    ok: true,
    name: input.name.trim(),
    tiles: geometry.tiles,
    walls: geometry.walls,
    doorPosition: generateDoorPosition(geometry.tiles, geometry.walls),
    floorTextureId: input.floorTextureId,
    wallTextureId: input.wallTextureId,
    isPublic: input.isPublic,
    password: input.isPublic ? null : password,
  };
}

router.post("/rooms", requireAuth as any, async (req: AuthRequest, res): Promise<void> => {
  const [{ total }] = await db
    .select({ total: count() })
    .from(roomsTable)
    .where(eq(roomsTable.ownerId, req.player!.id));

  if (Number(total) >= MAX_ROOMS_PER_PLAYER) {
    res.status(409).json({ error: `Cada jugador puede tener como máximo ${MAX_ROOMS_PER_PLAYER} salas` });
    return;
  }

  const validated = validateRoomInput(req.body);
  if (!validated.ok) {
    res.status(400).json({ error: validated.message });
    return;
  }

  const [created] = await db
    .insert(roomsTable)
    .values({
      ownerId: req.player!.id,
      name: validated.name,
      tiles: validated.tiles,
      walls: validated.walls,
      doorPosition: validated.doorPosition,
      floorTextureId: validated.floorTextureId,
      wallTextureId: validated.wallTextureId,
      isPublic: validated.isPublic,
      password: validated.password,
    })
    .returning({
      id: roomsTable.id,
      ownerId: roomsTable.ownerId,
      name: roomsTable.name,
      tiles: roomsTable.tiles,
      walls: roomsTable.walls,
      doorPosition: roomsTable.doorPosition,
      floorTextureId: roomsTable.floorTextureId,
      wallTextureId: roomsTable.wallTextureId,
      isPublic: roomsTable.isPublic,
      hasPassword: roomsTable.password,
      createdAt: roomsTable.createdAt,
    });

  if (!created) {
    res.status(500).json({ error: "No se pudo crear la sala" });
    return;
  }

  res.status(201).json(serializeRoom(created));
});

router.get("/rooms/public", requireAuth as any, async (_req: AuthRequest, res) => {
  const rooms = await db
    .select({
      id: roomsTable.id,
      ownerId: roomsTable.ownerId,
      ownerUsername: playersTable.username,
      name: roomsTable.name,
      hasPassword: roomsTable.password,
      createdAt: roomsTable.createdAt,
    })
    .from(roomsTable)
    .innerJoin(playersTable, eq(playersTable.id, roomsTable.ownerId))
    .where(eq(roomsTable.isPublic, true))
    .orderBy(desc(roomsTable.createdAt))
    .limit(50);

  res.json(
    rooms.map((room) => ({
      ...room,
      hasPassword: room.hasPassword !== null,
    })),
  );
});

router.get("/rooms/mine", requireAuth as any, async (req: AuthRequest, res) => {
  const [room] = await db
    .select({
      id: roomsTable.id,
      ownerId: roomsTable.ownerId,
      name: roomsTable.name,
      tiles: roomsTable.tiles,
      walls: roomsTable.walls,
      doorPosition: roomsTable.doorPosition,
      floorTextureId: roomsTable.floorTextureId,
      wallTextureId: roomsTable.wallTextureId,
      isPublic: roomsTable.isPublic,
      hasPassword: roomsTable.password,
      createdAt: roomsTable.createdAt,
    })
    .from(roomsTable)
    .where(eq(roomsTable.ownerId, req.player!.id))
    .orderBy(desc(roomsTable.createdAt))
    .limit(1);

  if (!room) {
    res.status(404).json({ error: "Habitación no encontrada" });
    return;
  }

  res.json({
    ...room,
    hasPassword: room.hasPassword !== null,
  });
});

router.get("/rooms/mine/all", requireAuth as any, async (req: AuthRequest, res) => {
  const rooms = await db
    .select(roomFields)
    .from(roomsTable)
    .where(eq(roomsTable.ownerId, req.player!.id))
    .orderBy(desc(roomsTable.createdAt));

  res.json(rooms.map(serializeRoom));
});

router.get("/rooms/mine/:roomId", requireAuth as any, async (req: AuthRequest, res): Promise<void> => {
  const roomId = req.params.roomId;
  if (typeof roomId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(roomId)) {
    res.status(400).json({ error: "ID de sala inválido" });
    return;
  }

  const [room] = await db
    .select(roomFields)
    .from(roomsTable)
    .where(and(eq(roomsTable.id, roomId), eq(roomsTable.ownerId, req.player!.id)))
    .limit(1);

  if (!room) {
    res.status(404).json({ error: "Sala no encontrada" });
    return;
  }

  res.json(serializeRoom(room));
});

router.delete("/rooms/mine/:roomId", requireAuth as any, async (req: AuthRequest, res): Promise<void> => {
  const roomId = req.params.roomId;
  if (typeof roomId !== "string" || !roomId) {
    res.status(400).json({ error: "ID de sala inválido" });
    return;
  }

  const [deleted] = await db
    .delete(roomsTable)
    .where(and(eq(roomsTable.id, roomId), eq(roomsTable.ownerId, req.player!.id)))
    .returning({ id: roomsTable.id });

  if (!deleted) {
    res.status(404).json({ error: "Sala no encontrada" });
    return;
  }

  roomManager.remove(roomId);
  res.sendStatus(204);
});

export default router;