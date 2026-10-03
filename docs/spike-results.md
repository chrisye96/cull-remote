# Spike results: SDK thumbnails and metadata API

Date: 2026-10-02
Catalog: `F:\Photos\test_category\test\test.lrcat` (Lightroom Classic 13), 30 NEF files, folder `Photos\260820_Cat`.
Runner: `spike/preview-bench.lrdevplugin`, analysed with `spike/analyze.ps1`.

## Preview timing

Run 1 (first request after import):

| Size | Photos | MedianMs | MaxMs | MaxCallbacks | MinLongEdge | AvgKB |
|---|---|---|---|---|---|---|
| 400 | 30 | 16 | 34 | 1 | 756 | 67 |
| 1280 | 30 | 141 | 243 | 1 | 1512 | 210 |
| 2560 | 30 | 402 | 555 | 1 | 3024 | 574 |

Run 2 (same session, previews already built):

| Size | Photos | MedianMs | MaxMs | MaxCallbacks | MinLongEdge | AvgKB |
|---|---|---|---|---|---|---|
| 400 | 30 | 14 | 29 | 1 | 756 | 67 |
| 1280 | 30 | 58 | 136 | 1 | 1512 | 210 |
| 2560 | 30 | 195 | 538 | 1 | 3024 | 574 |

No request timed out. Lightroom returns the next preview level at or above the requested size, so every tier comes back larger than asked (400 to 756, 1280 to 1512, 2560 to 3024).

## meta.csv (run 2, identical to run 1)

```
kind,key,value,status,readback,colorName
set,rating,3,executed,3,gray
set,rating,0,Invalid rating: 0,error,gray
set,colorNameForLabel,red,executed,red,red
set,colorNameForLabel,none,executed,gray,gray
set,label,Red,executed,error,red
set,label,,executed,error,gray
set,pickStatus,1,executed,1,gray
set,pickStatus,-1,executed,-1,gray
set,pickStatus,0,executed,0,gray
restore,skipped (original state not captured)
lookup,findPhotoByUuid,C2620F8D-36D6-4578-A159-A8EC8F522FB0,true
lookup,getFolderByPath,F:\Photos\test_category\test\Photos,true
lookup,getCollectionByLocalIdentifier,4288786,true
```

## Gates

| Gate | Result | Evidence |
|---|---|---|
| G1 std tier | PASS | median 58 ms, min long edge 1512 |
| G2 hd tier | PASS | median 195 ms, min long edge 3024 |
| G3 clear rating with 0 | FAIL | `setRawMetadata('rating', 0)` raises `Invalid rating: 0` |
| G4 clear label with `none` | PASS | `colorNameForLabel='none'` reads back `gray` (no label) |
| G5 lookups | PASS | all three `true` |

`MaxCallbacks` is 1 at every size, so `getPreview` keeps the single-callback wait.

## Decisions for Task 4

- Rating 0 is sent to the SDK as `nil` (G3 fallback). Not yet verified; Task 4 Step 8 checks clearing a rating explicitly.
- `colorNameForLabel` stays the write key. With no label the SDK reports `gray`, which `listPhotos` already maps to `none` because only the five colours are accepted.
- `label` is writable (`Red` set the red label) but `getRawMetadata('label')` is not a valid read key, which is why the spike's restore step was skipped. Not used.
- Preview source stays `requestJpegThumbnail`; no RAW extraction needed.

## Inputs for Plan 2

- Average cached size per photo: thumb 67 KB, std 210 KB, hd 574 KB (one 2560 preview reached 1.1 MB).
- Server side cost is small (tens to a few hundred ms per preview), so bulk caching speed will be bound by the network, not Lightroom.

## Side effect on the test catalog

The restore step was skipped, so the first selected photo was left with rating 3, no label, no flag.
