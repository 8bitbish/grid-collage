#!/bin/bash
# Regenerates the fixtures too big to commit. Needs ffmpeg with libvpx and
# libvorbis. The two small ones (clip.webm, photo.heic) are in git already.
#
# Nothing samples the pixels of the JPEGs — they exist to be a realistic phone
# photo, because the memory tests measure what a 12 megapixel decode costs.
# What matters is the dimensions and that they do not compress to nothing.
set -e
cd "$(dirname "$0")"

echo "12 photos at 4032x3024…"
for i in $(seq 0 11); do
  [ -f "photo$i.jpg" ] && continue
  ffmpeg -y -loglevel error \
    -f lavfi -i "nullsrc=s=4032x3024,geq=random(1)*255:128:128" \
    -frames:v 1 -q:v 2 "photo$i.jpg"
done

echo "12 clips at 1080x1920…"
mkdir -p many
for i in $(seq 0 11); do
  [ -f "many/clip$i.webm" ] && continue
  ffmpeg -y -loglevel error \
    -f lavfi -i "color=c=0x$(printf '%02x' $((i*20)))40c0:s=1080x1920:d=4:r=30" \
    -f lavfi -i "sine=frequency=$((300+i*40)):duration=4" \
    -c:v libvpx -b:v 1500k -c:a libvorbis -shortest "many/clip$i.webm"
done

# H.264 on purpose: the bundled Chromium cannot decode it, which is the point.
echo "clip.mp4, H.264 + AAC…"
[ -f clip.mp4 ] || ffmpeg -y -loglevel error \
  -f lavfi -i "testsrc=s=1080x1920:d=3:r=30" \
  -f lavfi -i "sine=frequency=440:duration=3" \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest clip.mp4

echo "done. $(du -sh . | cut -f1) in $(pwd)"
