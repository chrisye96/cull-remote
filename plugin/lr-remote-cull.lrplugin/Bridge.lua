local LrTasks = import 'LrTasks'
local LrHttp = import 'LrHttp'
local LrDate = import 'LrDate'
local logger = import 'LrLogger'('LrRemoteCull')
logger:enable('logfile')
local json = require 'json'
local Commands = require 'Commands'

local BASE = 'http://127.0.0.1:47801'

local function post(id, body, contentType)
  local reply = LrHttp.post(BASE .. '/result/' .. id, body, { { field = 'Content-Type', value = contentType } }, 'POST', 10)
  if reply == nil then logger:warn('result post failed for command ' .. tostring(id)) end
end

local function handle(cmd)
  local handler = Commands[cmd.type]
  if not handler then
    return post(cmd.id, json.encode({ ok = false, error = 'unknown_command' }), 'application/json')
  end
  -- LrTasks.pcall, not pcall: handlers yield (sleep, write access).
  local ok, result, contentType = LrTasks.pcall(handler, cmd.params or {})
  if not ok then
    post(cmd.id, json.encode({ ok = false, error = tostring(result) }), 'application/json')
  elseif contentType then
    post(cmd.id, result, contentType)
  else
    post(cmd.id, json.encode({ ok = true, data = result }), 'application/json')
  end
end

local Bridge = {}

function Bridge.start()
  LrTasks.startAsyncTask(function()
    while _G.lrRemoteCullRunning do
      local started = LrDate.currentTime()
      local body = LrHttp.get(BASE .. '/next', nil, 35)
      if not body or body == '' then
        -- Companion server is not running; retry quietly.
        LrTasks.sleep(2)
      else
        local ok, cmd = pcall(json.decode, body)
        if ok and type(cmd) == 'table' and cmd.id then
          -- LrTasks.pcall, not pcall: handle yields. A failure here must never end the loop.
          local handled, err = LrTasks.pcall(handle, cmd)
          if not handled then
            logger:error('command ' .. tostring(cmd.id) .. ' failed: ' .. tostring(err))
            -- Best effort so the server is not left waiting for a result.
            LrTasks.pcall(post, cmd.id, '{"ok":false,"error":"internal"}', 'application/json')
          end
        elseif LrDate.currentTime() - started < 1 then
          -- Idle, error or non-JSON reply that came back fast (error loop, or another
          -- poller released this one): back off instead of spinning.
          LrTasks.sleep(1)
        end
      end
    end
  end)
end

return Bridge
