/**
 * Route publique /terms — Conditions Générales d'Utilisation.
 * Accessible via https://nightfinder.support/terms (App Store Connect).
 */
import LegalDoc from './legal';

export default function Terms() {
  return <LegalDoc docOverride="cgu" />;
}
