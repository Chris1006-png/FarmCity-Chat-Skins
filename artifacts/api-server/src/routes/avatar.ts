import { Router } from "express";
import { db } from "@workspace/db";
import { avatarsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../lib/auth";

const router = Router();

const ACCESSORY_COLORS = ["#A9F0F0", "#5BC0EB", "#7B61FF", "#F06AA7", "#7BD88F", "#F5B942", "#F2F2F2"];
const DEFAULT_ACCESSORY_COLOR = ACCESSORY_COLORS[0];

const AVATAR_OPTIONS = {
  skinColors: ["#FDDBB4", "#F1C27D", "#E0AC69", "#C68642", "#8D5524", "#4A2912"],
  hairColors: [
  "#17131F", "#3B241A", "#6B3E26", "#A76435", "#D28A45", "#E1B56A",
  "#8B2E2E", // rojo/pelirrojo
  "#7A7A7A", // gris
  "#F5F0E6", // rubio platino / blanco
  "#2C3E50", // azul oscuro (fantasía)
  "#5B2C6F", // violeta (fantasía)
],
  hairStyles: ["restaurado"],
  shirtColors: ["#E74C3C", "#3498DB", "#2ECC71", "#F39C12", "#9B59B6", "#1ABC9C", "#E67E22", "#ECF0F1", "#2C3E50", "#F8C471"],
  pantColors: ["#2C3E50", "#6E2C00", "#1A5276", "#145A32", "#512E5F", "#17202A", "#7B7D7D", "#F0E6CA"],
  pantsStyles: ["none", "black-simple"],
  hatStyles: ["none", "cap", "sombrero", "straw", "cowboy", "beanie"],
  accessories: ["none", "vr-goggles"],
  accessoryColors: ACCESSORY_COLORS,
};

router.get("/avatar", requireAuth as any, async (req: AuthRequest, res) => {
  const playerId = req.player!.id;
  const [avatar] = await db.select().from(avatarsTable).where(eq(avatarsTable.playerId, playerId)).limit(1);
  if (!avatar) {
    res.status(404).json({ error: "Avatar no encontrado" });
    return;
  }
  res.json(avatar);
});

router.post("/avatar", requireAuth as any, async (req: AuthRequest, res) => {
  const playerId = req.player!.id;
  const { skinColor, hairColor, hairStyle, shirtColor, pantsColor, pantsStyle, hatStyle, accessory, accessoryColor } = req.body as {
    skinColor?: string;
    hairColor?: string;
    hairStyle?: string;
    shirtColor?: string;
    pantsColor?: string;
    pantsStyle?: string;
    hatStyle?: string | null;
    accessory?: string | null;
    accessoryColor?: string | null;
  };

  if (!skinColor || !hairColor || !hairStyle || !shirtColor || !pantsColor) {
    res.status(400).json({ error: "Faltan campos requeridos del avatar" });
    return;
  }

  const existing = await db.select().from(avatarsTable).where(eq(avatarsTable.playerId, playerId)).limit(1);

  if (existing.length) {
    const [updated] = await db
      .update(avatarsTable)
      .set({
        skinColor,
        hairColor,
        hairStyle,
        shirtColor,
        pantsColor,
        pantsStyle: pantsStyle ?? "none",
        hatStyle: hatStyle ?? null,
        accessory: accessory ?? null,
        accessoryColor: accessoryColor ?? DEFAULT_ACCESSORY_COLOR,
      })
      .where(eq(avatarsTable.playerId, playerId))
      .returning();
    res.json(updated);
  } else {
    const [created] = await db
      .insert(avatarsTable)
      .values({
        playerId,
        skinColor,
        hairColor,
        hairStyle,
        shirtColor,
        pantsColor,
        pantsStyle: pantsStyle ?? "none",
        hatStyle: hatStyle ?? null,
        accessory: accessory ?? null,
        accessoryColor: accessoryColor ?? DEFAULT_ACCESSORY_COLOR,
      })
      .returning();
    res.json(created);
  }
});

router.get("/avatar/options", (_req, res) => {
  res.json(AVATAR_OPTIONS);
});

export default router;
