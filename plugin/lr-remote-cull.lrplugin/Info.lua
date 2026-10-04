return {
  LrSdkVersion = 13.0,
  LrSdkMinimumVersion = 10.0,
  LrToolkitIdentifier = 'dev.chrisye.lrremotecull',
  LrPluginName = 'LR Remote Cull',
  LrInitPlugin = 'Init.lua',
  LrForceInitPlugin = true,
  LrShutdownPlugin = 'Shutdown.lua',
  LrLibraryMenuItems = {
    { title = 'Remote Cull: start bridge', file = 'StartBridge.lua' },
    { title = 'Remote Cull: show address and QR code', file = 'ShowAddress.lua' },
  },
  VERSION = { major = 0, minor = 4, revision = 0 },
}
