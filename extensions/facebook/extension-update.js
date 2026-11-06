export function isNewerExtensionVersion(requiredVersion, installedVersion) {
  const valid = value => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
  if (!valid(requiredVersion) || !valid(installedVersion)) return false;
  const required = requiredVersion.split('.').map(Number);
  const installed = installedVersion.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (required[index] !== installed[index]) return required[index] > installed[index];
  }
  return false;
}

export function shouldReloadForServerTarget({
  requiredVersion,
  installedVersion,
  reloadSafe,
  localWorkInProgress,
}) {
  return reloadSafe === true
    && localWorkInProgress === false
    && isNewerExtensionVersion(requiredVersion, installedVersion);
}
