local LrApplication = import 'LrApplication'
local LrTasks = import 'LrTasks'
local LrDate = import 'LrDate'
local LrPathUtils = import 'LrPathUtils'
local LrFileUtils = import 'LrFileUtils'
local LrDialogs = import 'LrDialogs'

local SIZES = { 400, 1280, 2560 }
local OUT = LrPathUtils.child(LrPathUtils.getStandardFilePath('temp'), 'lr-remote-cull-spike')

-- Error text may contain commas and newlines; flatten it so one CSV row stays one row.
local function csvSafe(value)
  return (tostring(value):gsub('[,\r\n]', ' '))
end

local function openOrFail(path, mode)
  local f = io.open(path, mode)
  if not f then error('cannot open ' .. path, 0) end
  return f
end

local function benchPreviews(photos, log)
  for _, photo in ipairs(photos) do
    local name = photo:getFormattedMetadata('fileName')
    for _, size in ipairs(SIZES) do
      local start, calls, last = LrDate.currentTime(), 0, nil
      -- Set once the wait loop is over so a late callback can never touch a closed file.
      local finished = false
      -- The request object must stay referenced until the callback has fired.
      local request = photo:requestJpegThumbnail(size, size, function(jpeg, message)
        if finished then return end
        calls = calls + 1
        local ms = math.floor((LrDate.currentTime() - start) * 1000)
        log:write(string.format('%s,%d,%d,%d,%d\n', name, size, calls, ms, jpeg and #jpeg or -1))
        if jpeg then last = jpeg end
      end)
      -- Wait for the first callback, then one more second to observe repeat callbacks.
      local waited, firstAt = 0, nil
      while waited < 20 do
        LrTasks.sleep(0.05)
        waited = waited + 0.05
        if calls > 0 then
          firstAt = firstAt or waited
          if waited - firstAt >= 1 then break end
        end
      end
      finished = true
      request = nil
      if calls == 0 then
        log:write(string.format('%s,%d,0,20000,-1\n', name, size))
      end
      if last then
        local f = io.open(LrPathUtils.child(OUT, string.format('%s_%d.jpg', name, size)), 'wb')
        if f then
          f:write(last)
          f:close()
        end
      end
    end
  end
end

-- Reads a raw metadata value under a protected call; returns the value, or 'error' on failure.
local function safeRead(photo, key)
  local ok, value = LrTasks.pcall(function() return photo:getRawMetadata(key) end)
  if ok then return value end
  return 'error'
end

local function checkMetadata(catalog, photo, meta)
  local checks = {
    { 'rating', 3 }, { 'rating', 0 },
    { 'colorNameForLabel', 'red' }, { 'colorNameForLabel', 'none' },
    { 'label', 'Red' }, { 'label', '' },
    { 'pickStatus', 1 }, { 'pickStatus', -1 }, { 'pickStatus', 0 },
  }

  -- Capture the original state so the test photo can be restored afterwards.
  local original
  local capOk = LrTasks.pcall(function()
    original = {
      rating = photo:getRawMetadata('rating'),
      label = photo:getRawMetadata('label'),
      pickStatus = photo:getRawMetadata('pickStatus'),
    }
  end)
  if not capOk then original = nil end

  for _, check in ipairs(checks) do
    local key, value = check[1], check[2]
    -- LrTasks.pcall, not pcall: withWriteAccessDo yields.
    local ok, status = LrTasks.pcall(function()
      return catalog:withWriteAccessDo('Spike write', function()
        photo:setRawMetadata(key, value)
      end, { timeout = 5 })
    end)
    local readback
    if ok then
      -- Read back outside the write gate so the committed value is observed.
      readback = tostring(safeRead(photo, key))
    else
      status = csvSafe(status)
      readback = 'error'
    end
    meta:write(string.format('set,%s,%s,%s,%s,%s\n', key, tostring(value), tostring(status), readback,
      tostring(safeRead(photo, 'colorNameForLabel'))))
  end

  if original then
    local ok, status = LrTasks.pcall(function()
      return catalog:withWriteAccessDo('Spike restore', function()
        photo:setRawMetadata('rating', original.rating)
        photo:setRawMetadata('label', original.label)
        photo:setRawMetadata('pickStatus', original.pickStatus)
      end, { timeout = 5 })
    end)
    meta:write(string.format('restore,%s\n', csvSafe(status)))
  else
    meta:write('restore,skipped (original state not captured)\n')
  end
end

-- fn returns the "value,result" part of the row (or nil to write nothing).
local function lookup(meta, name, fn)
  local ok, row = LrTasks.pcall(fn)
  if not ok then
    meta:write(string.format('lookup,%s,error,%s\n', name, csvSafe(row)))
  elseif row ~= nil then
    meta:write(string.format('lookup,%s,%s\n', name, row))
  end
end

local function checkLookups(catalog, photo, meta)
  lookup(meta, 'findPhotoByUuid', function()
    local uuid = photo:getRawMetadata('uuid')
    local found = catalog:findPhotoByUuid(uuid)
    return csvSafe(uuid) .. ',' .. tostring(found ~= nil and found.localIdentifier == photo.localIdentifier)
  end)
  lookup(meta, 'getFolderByPath', function()
    local folder = catalog:getFolders()[1]
    if not folder then return nil end
    local path = folder:getPath()
    return csvSafe(path) .. ',' .. tostring(catalog:getFolderByPath(path) ~= nil)
  end)
  lookup(meta, 'getCollectionByLocalIdentifier', function()
    local collection = catalog:getChildCollections()[1]
    if not collection then return nil end
    return tostring(collection.localIdentifier) .. ',' ..
      tostring(catalog:getCollectionByLocalIdentifier(collection.localIdentifier) ~= nil)
  end)
end

LrTasks.startAsyncTask(function()
  local catalog = LrApplication.activeCatalog()
  local photos = catalog:getTargetPhotos()
  if #photos == 0 then
    LrDialogs.message('Select some photos first', nil, 'info')
    return
  end
  if LrDialogs.confirm('Run benchmark on this catalog? It writes and then tries to restore rating, label and flag on the first selected photo.', catalog:getPath(), 'Run', 'Cancel') ~= 'ok' then
    return
  end

  local log, meta
  local ok, err = LrTasks.pcall(function()
    LrFileUtils.createAllDirectories(OUT)
    log = openOrFail(LrPathUtils.child(OUT, 'results.csv'), 'w')
    meta = openOrFail(LrPathUtils.child(OUT, 'meta.csv'), 'w')
    log:write('file,size,callback,ms,bytes\n')
    meta:write('kind,key,value,status,readback,colorName\n')
    benchPreviews(photos, log)
    checkMetadata(catalog, photos[1], meta)
    checkLookups(catalog, photos[1], meta)
  end)
  if log then log:close() end
  if meta then meta:close() end

  if ok then
    LrDialogs.message('Benchmark finished', OUT, 'info')
  else
    LrDialogs.message('Benchmark failed', tostring(err), 'critical')
  end
end)
