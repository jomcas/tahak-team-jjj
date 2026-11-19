/** Danger banners take priority over optional demo controls. */
export function showDemoDetails(expanded: boolean, alertActive: boolean): boolean {
  return expanded && !alertActive;
}
