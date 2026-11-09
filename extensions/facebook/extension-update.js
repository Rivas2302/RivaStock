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

export function hasExtensionWorkInProgress(state = {}, supplierCapture = null, runtimeBusy = false) {
  return runtimeBusy === true
    || Boolean(state.activeJob || state.activeRehearsal || state.historicalReview
      || state.pendingClaim || state.pendingRehearsalClaim
      || Object.keys(state.ownContentTrackers ?? {}).length > 0
      || supplierCapture?.status === 'reading');
}

export function shouldReloadForDiskVersion({ diskVersion, installedVersion, localWorkInProgress }) {
  return localWorkInProgress === false && isNewerExtensionVersion(diskVersion, installedVersion);
}

export function shouldReloadForServerTarget({
  requiredVersion,
  diskVersion,
  installedVersion,
  reloadSafe,
  localWorkInProgress,
}) {
  return reloadSafe === true
    && localWorkInProgress === false
    && isNewerExtensionVersion(requiredVersion, installedVersion)
    && isNewerExtensionVersion(diskVersion, installedVersion)
    && typeof requiredVersion === 'string'
    && /^\d+\.\d+\.\d+$/.test(requiredVersion)
    && !isNewerExtensionVersion(requiredVersion, diskVersion);
}
