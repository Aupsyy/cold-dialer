// La configuration d'envoi côté serveur : le branchement rangé en base (lu avec la clé service, la seule à voir le jeton), puis les
// variables d'environnement. Ne lève jamais : au moindre souci, on retombe sur les variables, puis sur « éteint ».
// Réservé au serveur : lib/supabase/service.ts (« server-only ») fait échouer le build si un composant client importe ce fichier.

import { rpcService } from "@/lib/supabase/service";
import { configurationEffective, lireJetonServeur } from "./branchement";
import type { ConfigConcours } from "./configuration";

/** La configuration de l'envoi des compteurs, ou null (module éteint). Base d'abord, variables CONCOURS_* ensuite. */
export async function configurationEnvoi(env: NodeJS.ProcessEnv = process.env): Promise<ConfigConcours | null> {
  let enBase: ConfigConcours | null = null;
  try {
    const { data, error } = await rpcService(env)("concours_jeton_serveur", {});
    if (!error) enBase = lireJetonServeur(data);
  } catch {
    // clé service absente, base injoignable ou migration 0002 pas jouée : l'ancienne méthode continue de marcher
  }
  return configurationEffective(enBase, env);
}
