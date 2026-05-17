import type { Provider } from "../types/media.js";
import jikan from "./jikan.js";
import anilist from "./anilist.js";
import consumet from "./consumet.js";
import animepahe from "./animepahe.js";
import tvmaze from "./tvmaze.js";
import { watchtvProvider } from "./watchtv.js";

// Registry maps id-prefix → provider
const registry: Record<string, Provider> = {
  jikan,
  anilist,
  consumet,
  animepahe,
  tvmaze,
  watchtv: watchtvProvider,
};

export function getProvider(mediaId: string): { provider: Provider; externalId: string } {
  const colonIdx = mediaId.indexOf(":");
  if (colonIdx === -1) throw new Error(`Invalid media id: ${mediaId}`);

  const prefix = mediaId.slice(0, colonIdx);
  const externalId = mediaId.slice(colonIdx + 1);

  const provider = registry[prefix];
  if (!provider) throw new Error(`No provider registered for prefix "${prefix}"`);

  return { provider, externalId };
}

export { jikan, anilist, consumet, animepahe, tvmaze };
export default registry;
