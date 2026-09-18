import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { playersTable, avatarsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { signToken, requireAuth, type AuthRequest } from "../lib/auth";

const router = Router();

function serializePlayer(
  player: typeof playersTable.$inferSelect,
  avatar?: typeof avatarsTable.$inferSelect,
) {
  return {
    id: player.id,
    username: player.username,
    age: player.age,
    nickname: player.nickname,
    status: player.status,
    language: player.language as "es" | "en",
    createdAt: player.createdAt,
    isOnline: player.isOnline,
    avatar: avatar ?? undefined,
  };
}

function readCredentials(body: unknown): { username: string; password: string } | null {
  if (!body || typeof body !== "object") return null;

  const input = body as { username?: unknown; password?: unknown };
  if (typeof input.username !== "string" || typeof input.password !== "string") {
    return null;
  }

  const username = input.username.trim();
  if (!username || !input.password) return null;

  return { username, password: input.password };
}

router.post("/auth/register", async (req, res) => {
  const credentials = readCredentials(req.body);

  if (!credentials) {
    res.status(400).json({ error: "Usuario y contraseña son requeridos" });
    return;
  }
  const { username, password } = credentials;
  if (username.length < 3 || username.length > 20) {
    res.status(400).json({ error: "El usuario debe tener entre 3 y 20 caracteres" });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
    return;
  }

  const existing = await db
    .select()
    .from(playersTable)
    .where(sql`lower(${playersTable.username}) = lower(${username})`)
    .limit(1);
  if (existing.length) {
    res.status(409).json({ error: "Ese nombre de usuario ya está en uso" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const [player] = await db
    .insert(playersTable)
    .values({ username, passwordHash, isOnline: true })
    .returning();
  if (!player) {
    res.status(500).json({ error: "Error al crear el jugador" });
    return;
  }

  const token = signToken({ playerId: player.id, username: player.username });
  res.status(201).json({
    player: serializePlayer({ ...player, isOnline: true }),
    token,
  });
});

router.post("/auth/login", async (req, res) => {
  const credentials = readCredentials(req.body);

  if (!credentials) {
    res.status(400).json({ error: "Usuario y contraseña son requeridos" });
    return;
  }
  const { username, password } = credentials;

  const [player] = await db
    .select()
    .from(playersTable)
    .where(sql`lower(${playersTable.username}) = lower(${username})`)
    .limit(1);
  if (!player) {
    res.status(401).json({ error: "Credenciales inválidas" });
    return;
  }

  const valid = await bcrypt.compare(password, player.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Credenciales inválidas" });
    return;
  }

  await db.update(playersTable).set({ isOnline: true }).where(eq(playersTable.id, player.id));

  const avatar = await db.select().from(avatarsTable).where(eq(avatarsTable.playerId, player.id)).limit(1);
  const token = signToken({ playerId: player.id, username: player.username });

  res.json({
    player: serializePlayer({ ...player, isOnline: true }, avatar[0]),
    token,
  });
});

router.post("/auth/logout", requireAuth as any, async (req: AuthRequest, res) => {
  if (req.player) {
    await db.update(playersTable).set({ isOnline: false }).where(eq(playersTable.id, req.player.id));
  }
  res.json({ success: true });
});

router.get("/auth/me", requireAuth as any, async (req: AuthRequest, res) => {
  const player = req.player!;
  const [row] = await db.select().from(playersTable).where(eq(playersTable.id, player.id)).limit(1);
  if (!row) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  const avatar = await db.select().from(avatarsTable).where(eq(avatarsTable.playerId, player.id)).limit(1);
  res.json(serializePlayer(row, avatar[0]));
});

router.patch("/auth/profile", requireAuth as any, async (req: AuthRequest, res) => {
  const body = req.body as {
    username?: unknown;
    age?: unknown;
    nickname?: unknown;
    status?: unknown;
    language?: unknown;
  } | undefined;

  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "No se recibieron cambios" });
    return;
  }

  const updates: {
    username?: string;
    age?: number | null;
    nickname?: string | null;
    status?: string | null;
    language?: "es" | "en";
  } = {};

  if (Object.prototype.hasOwnProperty.call(body, "username")) {
    if (typeof body.username !== "string") {
      res.status(400).json({ error: "El nombre no es válido" });
      return;
    }
    const username = body.username.trim();
    if (username.length < 3 || username.length > 20) {
      res.status(400).json({ error: "El nombre debe tener entre 3 y 20 caracteres" });
      return;
    }
    const existing = await db
      .select({ id: playersTable.id })
      .from(playersTable)
      .where(sql`lower(${playersTable.username}) = lower(${username}) AND ${playersTable.id} <> ${req.player!.id}`)
      .limit(1);
    if (existing.length) {
      res.status(409).json({ error: "Ese nombre de jugador ya está en uso" });
      return;
    }
    updates.username = username;
  }

  if (Object.prototype.hasOwnProperty.call(body, "age")) {
    if (body.age !== null && (!Number.isInteger(body.age) || Number(body.age) < 1 || Number(body.age) > 120)) {
      res.status(400).json({ error: "La edad debe estar entre 1 y 120 años" });
      return;
    }
    updates.age = body.age === null ? null : Number(body.age);
  }

  if (Object.prototype.hasOwnProperty.call(body, "nickname")) {
    if (body.nickname !== null && typeof body.nickname !== "string") {
      res.status(400).json({ error: "El apodo no es válido" });
      return;
    }
    const nickname = typeof body.nickname === "string" ? body.nickname.trim() : null;
    if (nickname && nickname.length > 24) {
      res.status(400).json({ error: "El apodo puede tener hasta 24 caracteres" });
      return;
    }
    updates.nickname = nickname || null;
  }

  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    if (body.status !== null && typeof body.status !== "string") {
      res.status(400).json({ error: "El estado no es válido" });
      return;
    }
    const status = typeof body.status === "string" ? body.status.trim() : null;
    if (status && status.length > 120) {
      res.status(400).json({ error: "El estado puede tener hasta 120 caracteres" });
      return;
    }
    updates.status = status || null;
  }

  if (Object.prototype.hasOwnProperty.call(body, "language")) {
    if (body.language !== "es" && body.language !== "en") {
      res.status(400).json({ error: "Idioma no disponible" });
      return;
    }
    updates.language = body.language;
  }

  if (!Object.keys(updates).length) {
    res.status(400).json({ error: "No se recibieron cambios" });
    return;
  }

  const [updated] = await db
    .update(playersTable)
    .set(updates)
    .where(eq(playersTable.id, req.player!.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Jugador no encontrado" });
    return;
  }

  const avatar = await db.select().from(avatarsTable).where(eq(avatarsTable.playerId, updated.id)).limit(1);
  const token = signToken({ playerId: updated.id, username: updated.username });
  res.json({ player: serializePlayer(updated, avatar[0]), token });
});

export default router;
