-- Manual restart from the Library menu, in case the poll loop is not running.
_G.lrRemoteCullRunning = true
require('Bridge').start()
