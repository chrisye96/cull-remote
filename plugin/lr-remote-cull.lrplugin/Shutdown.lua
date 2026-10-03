-- Stops the long-poll loop when the plugin is reloaded or disabled. The flag goes first so
-- a tracing failure can never leave the loop running.
_G.lrRemoteCullRunning = false
require('Trace')('shutdown')
