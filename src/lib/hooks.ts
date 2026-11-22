import { isConfigured, useSettings } from "../store/settings";

/** True when a server URL + credentials are present. */
export function useConfigured(): boolean {
  return isConfigured(useSettings((state) => state.settings));
}
