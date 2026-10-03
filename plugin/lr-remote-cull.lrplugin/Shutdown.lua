-- Stops the long-poll loop when the plugin is reloaded or disabled.
require('Trace')('shutdown')
_G.lrRemoteCullRunning = false
