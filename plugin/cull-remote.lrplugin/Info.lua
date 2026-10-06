return {
  LrSdkVersion = 13.0,
  LrSdkMinimumVersion = 10.0,
  LrToolkitIdentifier = 'dev.chrisye.cullremote',
  LrPluginName = 'Cull Remote',
  LrInitPlugin = 'Init.lua',
  LrForceInitPlugin = true,
  LrShutdownPlugin = 'Shutdown.lua',
  LrLibraryMenuItems = {
    { title = 'Cull Remote: start bridge', file = 'StartBridge.lua' },
    { title = 'Cull Remote: show address and QR code', file = 'ShowAddress.lua' },
  },
  VERSION = { major = 0, minor = 6, revision = 0 },
}
