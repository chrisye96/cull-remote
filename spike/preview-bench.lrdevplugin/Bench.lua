local LrApplication = import 'LrApplication'
local LrTasks = import 'LrTasks'
local LrDate = import 'LrDate'
local LrPathUtils = import 'LrPathUtils'
local LrFileUtils = import 'LrFileUtils'
local LrDialogs = import 'LrDialogs'

local SIZES = { 400, 1280, 2560 }
local OUT = LrPathUtils.child(LrPathUtils.getStandardFilePath('temp'), 'lr-remote-cull-spike')

local function benchPreviews(photos, log)
  for _, photo in ipairs(photos) do
    local name = photo:getFormattedMetadata('fileName')
    for _, size in ipairs(SIZES) do
      local start, calls, last = LrDate.currentTime(), 0, nil
      -- The request object must stay referenced until the callback has fired.
      local request = photo:requestJpegThumbnail(size, size, function(jpeg, message)
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
      request = nil
      if last then
        local f = io.open(LrPathUtils.child(OUT, string.format('%s_%d.jpg', name, size)), 'wb')
        f:write(last)
        f:close()
      end
    end
  end
end

local function checkMetadata(catalog, photo, meta)
  local checks = {
    { 'rating', 3 }, { 'rating', 0 },
    { 'colorNameForLabel', 'red' }, { 'colorNameForLabel', 'none' },
    { 'pickStatus', 1 }, { 'pickStatus', -1 }, { 'pickStatus', 0 },
  }
  for _, check in ipairs(checks) do
    local key, value = check[1], check[2]
    local status = catalog:withWriteAccessDo('Spike write', function()
      photo:setRawMetadata(key, value)
    end, { timeout = 5 })
    -- Read back outside the write gate so the committed value is observed.
    meta:write(string.format('set,%s,%s,%s,%s\n', key, tostring(value), tostring(status), tostring(photo:getRawMetadata(key))))
  end
end

local function checkLookups(catalog, photo, meta)
  local uuid = photo:getRawMetadata('uuid')
  local found = catalog:findPhotoByUuid(uuid)
  meta:write(string.format('lookup,findPhotoByUuid,%s,%s\n', uuid, tostring(found ~= nil and found.localIdentifier == photo.localIdentifier)))
  local folder = catalog:getFolders()[1]
  if folder then
    meta:write(string.format('lookup,getFolderByPath,%s,%s\n', folder:getPath(), tostring(catalog:getFolderByPath(folder:getPath()) ~= nil)))
  end
  local collection = catalog:getChildCollections()[1]
  if collection then
    meta:write(string.format('lookup,getCollectionByLocalIdentifier,%s,%s\n', tostring(collection.localIdentifier),
      tostring(catalog:getCollectionByLocalIdentifier(collection.localIdentifier) ~= nil)))
  end
end

LrTasks.startAsyncTask(function()
  local catalog = LrApplication.activeCatalog()
  local photos = catalog:getTargetPhotos()
  LrFileUtils.createAllDirectories(OUT)
  local log = io.open(LrPathUtils.child(OUT, 'results.csv'), 'w')
  log:write('file,size,callback,ms,bytes\n')
  benchPreviews(photos, log)
  log:close()
  local meta = io.open(LrPathUtils.child(OUT, 'meta.csv'), 'w')
  meta:write('kind,key,value,status,readback\n')
  if photos[1] then
    checkMetadata(catalog, photos[1], meta)
    checkLookups(catalog, photos[1], meta)
  end
  meta:close()
  LrDialogs.message('Benchmark finished', OUT, 'info')
end)
