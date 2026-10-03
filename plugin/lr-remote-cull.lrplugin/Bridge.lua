local LrTasks = import 'LrTasks'
local LrHttp = import 'LrHttp'
local LrDate = import 'LrDate'
local json = require 'json'
local trace = require 'Trace'
local Commands = require 'Commands'

local BASE = 'http://127.0.0.1:47801'
-- The server refuses plugin port calls without this header, so web pages cannot use it.
local PLUGIN_HEADER = { field = 'X-LRC-Plugin', value = '1' }

-- Error codes the web UI understands. Anything else (raw Lua errors carry file paths
-- and line numbers) is traced locally and reported to the phone as plugin_error.
local KNOWN_ERRORS = {
  invalid_op = true,
  photo_not_found = true,
  source_not_found = true,
  lr_busy = true,
  invalid_size = true,
  preview_timeout = true,
}

local function post(id, body, contentType)
  local reply = LrHttp.post(BASE .. '/result/' .. id, body, { PLUGIN_HEADER, { field = 'Content-Type', value = contentType } }, 'POST', 10)
  if reply == nil then trace('result post failed for command ' .. tostring(id)) end
end

local function handle(cmd)
  local handler = Commands[cmd.type]
  if not handler then
    return post(cmd.id, json.encode({ ok = false, error = 'unknown_command' }), 'application/json')
  end
  -- LrTasks.pcall, not pcall: handlers yield (sleep, write access).
  local ok, result, contentType = LrTasks.pcall(handler, cmd.params or {})
  if not ok then
    local message = tostring(result)
    trace('command ' .. tostring(cmd.id) .. ' (' .. tostring(cmd.type) .. ') failed: ' .. message)
    local code = KNOWN_ERRORS[message] and message or 'plugin_error'
    post(cmd.id, json.encode({ ok = false, error = code }), 'application/json')
  elseif contentType then
    post(cmd.id, result, contentType)
  else
    post(cmd.id, json.encode({ ok = true, data = result }), 'application/json')
  end
end

local Bridge = {}

-- Lightroom runs the init script several times at launch and again on reload. Each
-- start bumps a generation number shared through _G; a loop keeps polling only while
-- it is the newest, so exactly one loop survives and a reload picks up new code.
function Bridge.start()
  _G.lrRemoteCullGeneration = (_G.lrRemoteCullGeneration or 0) + 1
  local generation = _G.lrRemoteCullGeneration
  trace('bridge start, generation ' .. generation)
  LrTasks.startAsyncTask(function()
    while _G.lrRemoteCullRunning and _G.lrRemoteCullGeneration == generation do
      local started = LrDate.currentTime()
      local body = LrHttp.get(BASE .. '/next', { PLUGIN_HEADER }, 35)
      if not body or body == '' then
        -- Companion server is not running; retry quietly.
        LrTasks.sleep(2)
      else
        local ok, cmd = pcall(json.decode, body)
        if ok and type(cmd) == 'table' and cmd.id then
          -- LrTasks.pcall, not pcall: handle yields. A failure here must never end the loop.
          local handled, err = LrTasks.pcall(handle, cmd)
          if not handled then
            trace('command ' .. tostring(cmd.id) .. ' failed: ' .. tostring(err))
            -- Best effort so the server is not left waiting for a result.
            LrTasks.pcall(post, cmd.id, '{"ok":false,"error":"internal"}', 'application/json')
          end
        elseif LrDate.currentTime() - started < 1 then
          -- Idle, error or non-JSON reply that came back fast (error loop, or a newer
          -- poller released this one): back off instead of spinning.
          LrTasks.sleep(1)
        end
      end
    end
    trace('poll loop ' .. generation .. ' exited')
  end)
end

return Bridge
