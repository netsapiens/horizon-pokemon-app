/**
 * Horizon Pokemon App — the federated entry point loaded by the Horizon host.
 *
 * Registers one full-page route: "Pokemon", mounted under the host's /apps
 * outlet so it sits in the Apps menu alongside Example CRM (horizon-sdk-demo's
 * `ucaas-vendor-dashboard`), which is the placement this app exists to
 * demonstrate. Same shape as horizon-vcon-app, one menu over.
 */
import type { HorizonContext } from '@netsapiens/horizon-sdk';
import { useEffect, useMemo, useRef } from 'react';
import {
  HorizonContextProvider,
  useRemoteApp,
} from '@netsapiens/horizon-sdk';

import PokemonPage from './pages/PokemonPage';

// Injected at build time by webpack DefinePlugin (see webpack.config.js) —
// the same value as the ModuleFederationPlugin `name`, which the registered
// app row's `webpack_module` must match exactly. Never hardcode it twice.
declare const __MF_NAME__: string;

export default function App(horizonContext: HorizonContext) {
  const { sdk } = useRemoteApp(horizonContext, __MF_NAME__);

  // The host rebuilds `horizonContext` on every colour-mode change, `ui`
  // included. The wrapper below is memoized with empty deps to keep a STABLE
  // component identity (re-creating it would unmount the page on every
  // render), so it must read the LATEST context through this ref rather than
  // closing over the one captured at first paint — otherwise `theme` keeps
  // updating while `ui.theme`/`ui.styles` stay on the load-time mode.
  const contextRef = useRef(horizonContext);
  contextRef.current = horizonContext;

  // Wrap the page once so it renders with the live HorizonContext available
  // via useHorizonContext().
  const PokemonPageWithContext = useMemo(
    () =>
      function PokemonPageWithContext() {
        return (
          <HorizonContextProvider context={contextRef.current}>
            <PokemonPage />
          </HorizonContextProvider>
        );
      },
    [],
  );

  useEffect(() => {
    // registerRoute is async; surface failures rather than dropping them.
    sdk
      .registerRoute({
        id: 'pokemon-pokedex',
        // Mounts under the host's /apps outlet (-> /apps/pokemon), the same
        // menu Example CRM registers into.
        parentPath: '/apps',
        path: 'pokemon',
        label: 'Pokemon',
        icon: 'mdi:pokeball',
        placement: { last: true },
        // No `requiredScopes` on purpose, matching Example CRM: this is a
        // public-data demo page with nothing to gate, and /apps carries no
        // section floor, so any signed-in user can open it. Any page that
        // reads real customer data MUST declare a tier here instead — the
        // host no longer treats a hidden menu entry as a gate.
        component: PokemonPageWithContext,
      })
      .catch((error) =>
        console.error(
          '[Pokemon App] Failed to register Pokemon page:',
          error,
        ),
      );
  }, [sdk]);

  // Headless remote — all UI is injected into the host.
  return null;
}
