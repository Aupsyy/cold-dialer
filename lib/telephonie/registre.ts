// Le registre des adaptateurs de téléphonie : un par fournisseur (Onoff, Aircall, Ringover expérimental, softphone, téléphone).
// Importé par le navigateur (le Poste : adaptateurTelephonie(config.telephonie.fournisseur).client), par next.config.ts (la
// Permissions-Policy : originesMicro) et par les routes de webhook : aucun module Node, aucun accès au DOM au chargement, imports
// relatifs seulement (voir lib/telephonie/types.ts).

import { aircall } from "./aircall";
import { onoff } from "./onoff";
import { ringover } from "./ringover";
import { softphone } from "./softphone";
import { telephone } from "./telephone";
import type { AdaptateurTelephonie, FournisseurTelephonie, RegistreTelephonie } from "./types";

export const REGISTRE_TELEPHONIE: RegistreTelephonie = {
  onoff,
  aircall,
  ringover,
  softphone,
  telephone,
};

export function adaptateurTelephonie(
  id: FournisseurTelephonie,
  registre: RegistreTelephonie = REGISTRE_TELEPHONIE,
): AdaptateurTelephonie | null {
  return registre[id] ?? null;
}

/** Les origines qui ont droit au micro pour ce fournisseur (Permissions-Policy, au build). */
export function originesMicro(id: FournisseurTelephonie, registre: RegistreTelephonie = REGISTRE_TELEPHONIE): readonly string[] {
  return registre[id]?.originesMicro ?? [];
}
