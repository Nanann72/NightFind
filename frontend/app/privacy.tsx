/**
 * Route publique /privacy — Politique de confidentialité.
 * Accessible via https://nightfinder.support/privacy (App Store Connect).
 */
import LegalDoc from './legal';

export default function Privacy() {
  return <LegalDoc docOverride="privacy" />;
}
