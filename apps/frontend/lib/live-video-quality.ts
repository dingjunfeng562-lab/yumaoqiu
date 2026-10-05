import { VideoQuality } from 'livekit-client';

type Publication = { setVideoQuality: (quality: VideoQuality) => void };
const demands = new WeakMap<Publication, Map<symbol, 'low' | 'high'>>();

/** A camera card and PGM/PVW share one subscription: the largest demand wins. */
export function retainVideoQuality(publication: Publication, quality: 'low' | 'high') {
  const owners = demands.get(publication) ?? new Map<symbol, 'low' | 'high'>();
  demands.set(publication, owners);
  const owner = Symbol();
  const apply = () => publication.setVideoQuality(
    [...owners.values()].includes('high') ? VideoQuality.HIGH : VideoQuality.LOW,
  );
  owners.set(owner, quality);
  apply();
  return () => {
    if (!owners.delete(owner)) return;
    if (owners.size) apply();
    else demands.delete(publication);
  };
}
