GOAL:

- ✅ get zip index: already great value, as it can give us a tree very fast!
- ❌ get a specific file from a range and deflate it
- ❌ get multiple files using multipart-range
- create public R2 bucket and host any zip there after viewing/filtering with zipobject (bonus if in a way that i can easily get the best possible zip from a list of incrementally bigger zips for a given filter)
- create an optimizer to determine which chunks to get from the index when specific files are requested

Observations:

- Github doesn't support any of this, but with a cache we'll still have big advantage on any subsequent requests.
- Multipart range requests aren't supported by r2, regular range requests are
- Cloudflare workers with static assets don't return range-length header, so range requests don't work here. However, with R2 on a public URL it's fine.
- Reading the index of bun is 5MB out of 100MB uncompressed (37k files) and happens in about a second.
- The order of the files in the index seems to be:
  - dotfiles and root files alphabetically (this means its easy to retrieve this part, which is great for configfiles)
  - all folders and items there in, nested, alphabetically (depth first)
