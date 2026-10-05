-- Appends one line to %TEMP%\cull-remote-plugin.log. LrLogger's output location
-- varies by install, so lifecycle events and errors go to a fixed, findable file.
local LrPathUtils = import 'LrPathUtils'

local PATH = LrPathUtils.child(LrPathUtils.getStandardFilePath('temp'), 'cull-remote-plugin.log')

return function(message)
  local f = io.open(PATH, 'a')
  if f then
    f:write(os.date('%Y-%m-%d %H:%M:%S') .. ' ' .. message .. '\n')
    f:close()
  end
end
