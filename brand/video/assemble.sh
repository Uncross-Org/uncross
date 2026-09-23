#!/bin/zsh
# Assemble the launch clip from recorded frames.
#   zsh assemble.sh <firstFrame> <lastFrame> [footageSeconds]
# Real frames only, sped up to fit (the caption says so). 1080x1080, H.264,
# 30fps, yuv420p. It ends on the logo card and fades back into the first frame,
# so it loops without a hard cut.
set -e
cd "${0:A:h}"
S=$1; E=$2; D=${3:-4.8}
K=$((E - S + 1))
R=$(python3 -c "print(round($K/$D, 4))")
echo "frames $S..$E ($K) -> ${D}s footage at input rate $R fps"

# 1. Footage, with the caption burned in.
ffmpeg -y -loglevel error -framerate $R -start_number $S -i raw/f%05d.jpg -i overlay.png \
  -filter_complex "[0:v]scale=1080:1080:flags=lanczos,fps=30[b];[b][1:v]overlay=0:0,format=yuv420p[v]" \
  -map "[v]" -frames:v $(python3 -c "print(int($D*30))") -c:v libx264 -preset slow -crf 16 -r 30 footage.mp4

# 2. End card.
ffmpeg -y -loglevel error -loop 1 -t 1.7 -i endcard.png -vf "fps=30,format=yuv420p" -c:v libx264 -preset slow -crf 16 -r 30 endcard.mp4

# 3. First frame again, for the loop seam.
ffmpeg -y -loglevel error -i footage.mp4 -vf "select=eq(n\,0),loop=loop=15:size=1:start=0,fps=30,format=yuv420p" -frames:v 15 -c:v libx264 -preset slow -crf 16 -r 30 seam.mp4

# 4. footage -> endcard -> first frame, crossfaded.
ffmpeg -y -loglevel error -i footage.mp4 -i endcard.mp4 -i seam.mp4 -filter_complex \
  "[0:v][1:v]xfade=transition=fade:duration=0.35:offset=$(python3 -c "print($D-0.35)")[a]; \
   [a][2:v]xfade=transition=fade:duration=0.3:offset=$(python3 -c "print($D-0.35+1.7-0.3)"),format=yuv420p[v]" \
  -map "[v]" -c:v libx264 -preset slow -crf 17 -profile:v high -pix_fmt yuv420p -r 30 -movflags +faststart ../kit/video/launch.mp4 2>/dev/null || { mkdir -p ../kit/video; ffmpeg -y -loglevel error -i footage.mp4 -i endcard.mp4 -i seam.mp4 -filter_complex \
  "[0:v][1:v]xfade=transition=fade:duration=0.35:offset=$(python3 -c "print($D-0.35)")[a]; \
   [a][2:v]xfade=transition=fade:duration=0.3:offset=$(python3 -c "print($D-0.35+1.7-0.3)"),format=yuv420p[v]" \
  -map "[v]" -c:v libx264 -preset slow -crf 17 -profile:v high -pix_fmt yuv420p -r 30 -movflags +faststart ../kit/video/launch.mp4; }
# The frames are JPEGs, which are full-range; X and many players expect
# limited-range yuv420p and show shifted colour otherwise.
ffmpeg -y -loglevel error -i ../kit/video/launch.mp4 -vf "scale=in_range=full:out_range=tv,format=yuv420p" \
  -c:v libx264 -preset slow -crf 17 -profile:v high -level 4.1 -pix_fmt yuv420p -color_range tv \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -r 30 -movflags +faststart -an ../kit/video/launch.tmp.mp4
mv ../kit/video/launch.tmp.mp4 ../kit/video/launch.mp4
rm -f footage.mp4 endcard.mp4 seam.mp4
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,pix_fmt:format=duration,size -of default=nw=1 ../kit/video/launch.mp4
