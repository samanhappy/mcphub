export function isHostedModeEnabled(): boolean {
  return process.env.HUB_MODE === 'hosted';
}
