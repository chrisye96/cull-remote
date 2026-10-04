-- Opens the app's settings page in this computer's browser. It shows the address other
-- devices use and a QR code for it, which the hidden background server cannot print.
local LrHttp = import 'LrHttp'
LrHttp.openUrlInBrowser('http://127.0.0.1:47800/#settings')
