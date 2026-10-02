local LrApplication = import 'LrApplication'
local LrTasks = import 'LrTasks'

local LABELS = { red = true, yellow = true, green = true, blue = true, purple = true }
local PREVIEW_SIZES = { [400] = true, [1280] = true, [2560] = true }

local Commands = {}

-- ponytail: counts photos per source by materialising them. Fine for hundreds of
-- folders; cache the tree on the server if listing ever feels slow.
local function addFolder(out, folder, depth)
  out[#out + 1] = {
    id = 'f:' .. folder:getPath(),
    kind = 'folder',
    name = folder:getName(),
    depth = depth,
    count = #folder:getPhotos(false),
  }
  for _, child in ipairs(folder:getChildren()) do
    addFolder(out, child, depth + 1)
  end
end

local function addCollections(out, parent, depth)
  for _, set in ipairs(parent:getChildCollectionSets()) do
    out[#out + 1] = { kind = 'set', name = set:getName(), depth = depth, count = 0 }
    addCollections(out, set, depth + 1)
  end
  for _, collection in ipairs(parent:getChildCollections()) do
    out[#out + 1] = {
      id = 'c:' .. collection.localIdentifier,
      kind = 'collection',
      name = collection:getName(),
      depth = depth,
      count = #collection:getPhotos(),
    }
  end
end

function Commands.listSources()
  local catalog = LrApplication.activeCatalog()
  local out = {}
  for _, folder in ipairs(catalog:getFolders()) do
    addFolder(out, folder, 0)
  end
  addCollections(out, catalog, 0)
  return out
end

local function photosOf(catalog, sourceId)
  local kind, rest = string.match(sourceId, '^(%a):(.+)$')
  if kind == 'f' then
    local folder = catalog:getFolderByPath(rest)
    return folder and folder:getPhotos(false)
  elseif kind == 'c' then
    local collection = catalog:getCollectionByLocalIdentifier(tonumber(rest))
    return collection and collection:getPhotos()
  end
end

function Commands.listPhotos(params)
  local catalog = LrApplication.activeCatalog()
  local photos = photosOf(catalog, params.sourceId or '')
  if not photos then error('source_not_found', 0) end
  local raw = catalog:batchGetRawMetadata(photos,
    { 'uuid', 'rating', 'colorNameForLabel', 'pickStatus', 'dateTimeOriginal', 'fileFormat' })
  local formatted = catalog:batchGetFormattedMetadata(photos, { 'fileName' })
  local out = {}
  for _, photo in ipairs(photos) do
    local r = raw[photo]
    if r.fileFormat ~= 'VIDEO' then
      out[#out + 1] = {
        id = r.uuid,
        name = formatted[photo].fileName,
        time = r.dateTimeOriginal or 0,
        rating = r.rating or 0,
        label = LABELS[r.colorNameForLabel] and r.colorNameForLabel or 'none',
        pick = r.pickStatus or 0,
      }
    end
  end
  table.sort(out, function(a, b)
    if a.time ~= b.time then return a.time < b.time end
    return a.name < b.name
  end)
  return out
end

function Commands.getPreview(params)
  local size = tonumber(params.size)
  if not PREVIEW_SIZES[size] then error('invalid_size', 0) end
  local photo = LrApplication.activeCatalog():findPhotoByUuid(params.photoId)
  if not photo then error('photo_not_found', 0) end
  local data, message, done
  -- The request object must stay referenced until the callback has fired.
  local request = photo:requestJpegThumbnail(size, size, function(jpeg, err)
    if jpeg then data = jpeg else message = err end
    done = true
  end)
  local waited = 0
  while not done and waited < 20 do
    LrTasks.sleep(0.05)
    waited = waited + 0.05
  end
  request = nil
  if not data then error(message or 'preview_timeout', 0) end
  return data, 'image/jpeg'
end

-- Whitelist: the only three catalog fields this plugin may ever write.
local function toSdk(field, value)
  if field == 'rating' and type(value) == 'number' and value % 1 == 0 and value >= 0 and value <= 5 then
    return 'rating', (value > 0) and value or nil
  elseif field == 'label' and (value == 'none' or LABELS[value]) then
    return 'colorNameForLabel', value
  elseif field == 'pickStatus' and (value == -1 or value == 0 or value == 1) then
    return 'pickStatus', value
  end
end

function Commands.setMeta(params)
  local key, value = toSdk(params.field, params.value)
  if not key then error('invalid_op', 0) end
  local catalog = LrApplication.activeCatalog()
  local photo = catalog:findPhotoByUuid(params.photoId)
  if not photo then error('photo_not_found', 0) end
  local status = catalog:withWriteAccessDo('Remote cull', function()
    photo:setRawMetadata(key, value)
  end, { timeout = 5 })
  if status ~= 'executed' then error('lr_busy', 0) end
  return true
end

return Commands
