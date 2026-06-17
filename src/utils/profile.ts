import type { WnbaPlayerMeta } from "../types.js";

export function heightToCm(feetInches: string): number | null {
  const match = /^(\d+)-(\d+)$/.exec(feetInches.trim());
  if (!match) return null;
  const feet = Number.parseInt(match[1], 10);
  const inches = Number.parseInt(match[2], 10);
  if (Number.isNaN(feet) || Number.isNaN(inches)) return null;
  return Math.round((feet * 12 + inches) * 2.54);
}

export function metaToIngestPlayer(meta: WnbaPlayerMeta): {
  displayName: string;
  birthDate?: string | null;
  position?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
  hometown?: string | null;
} {
  const player: ReturnType<typeof metaToIngestPlayer> = {
    displayName: meta.displayName,
  };

  if (meta.birthDate) player.birthDate = meta.birthDate;
  if (meta.position) player.position = meta.position;
  if (meta.heightCm != null) player.heightCm = meta.heightCm;
  if (meta.weightKg != null) player.weightKg = meta.weightKg;
  if (meta.hometown) player.hometown = meta.hometown;

  return player;
}

/** Parse WNBA bio fields from the player info section. */
export function parseWnbaBioFromHtml(html: string): Pick<
  WnbaPlayerMeta,
  "position" | "heightCm" | "weightKg" | "hometown" | "birthDate"
> {
  const infoMatch =
    /<div[^>]*id="info"[^>]*>([\s\S]*?)<\/div>/i.exec(html) ??
    /<div[^>]*itemtype="https:\/\/schema\.org\/Person"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
  const text = infoMatch?.[1]?.replace(/<[^>]+>/g, " ") ?? html;

  let heightCm: number | null = null;
  let weightKg: number | null = null;
  let position: string | null = null;
  let hometown: string | null = null;
  let birthDate: string | null = null;

  const heightMatch =
    /(\d-\d+)\s*,\s*(\d+)\s*lb\s*\((\d+)\s*cm\s*,\s*(\d+)\s*kg\)/i.exec(text) ??
    /(\d-\d+)\s*,\s*(\d+)\s*lb/i.exec(text);
  if (heightMatch) {
    heightCm = heightToCm(heightMatch[1]) ?? (heightMatch[3] ? Number.parseFloat(heightMatch[3]) : null);
    if (heightMatch[4]) {
      weightKg = Number.parseFloat(heightMatch[4]);
    } else if (heightMatch[2]) {
      weightKg = Math.round(Number.parseInt(heightMatch[2], 10) / 2.20462);
    }
  }

  if (heightCm == null) {
    const altHeight =
      /(\d)-(\d+)\s*\((\d+)\s*cm\)/i.exec(text) ?? /(\d-\d+)\s*\((\d+)\s*cm\)/i.exec(text);
    if (altHeight) {
      if (altHeight[3]) {
        heightCm = Number.parseFloat(altHeight[3]);
      } else if (altHeight[2] !== undefined) {
        const feetInch =
          altHeight[2] !== undefined && altHeight[1] !== undefined
            ? `${altHeight[1]}-${altHeight[2]}`
            : altHeight[1];
        heightCm = heightToCm(feetInch);
      }
    }
  }

  if (weightKg == null) {
    const kgMatch = /(\d+(?:\.\d+)?)\s*kg/i.exec(text);
    if (kgMatch) weightKg = Number.parseFloat(kgMatch[1]);
  }

  const bornMatch = /Born:\s*([^▪]+?)(?:\s+in\s+([^▪]+?))?(?:\s+[a-z]{2}\s*$|$)/im.exec(text);
  if (bornMatch) {
    hometown = bornMatch[2]?.trim() ?? null;
  }

  const necroBirth = /id="necro-birth"[^>]*data-birth="(\d{4}-\d{2}-\d{2})"/i.exec(html);
  birthDate = necroBirth?.[1] ?? null;

  const posMatch =
    /Position:\s*([^▪\n]+?)(?=\s*\d-\d+|\s*\d+\s*cm|Born:|College:|High School:|$|\n)/i.exec(text) ??
    /Position:\s*([^▪]+)/i.exec(text);
  if (posMatch) {
    let pos = posMatch[1].replace(/\s+/g, " ").trim();
    pos = pos.replace(/\s*\d-\d+.*$/i, "").trim();
    pos = pos.split(/\n/)[0].trim();
    if (pos.length > 0 && pos.length < 80) position = pos;
  }

  return { position, heightCm, weightKg, hometown, birthDate };
}
