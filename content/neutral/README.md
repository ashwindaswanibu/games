# Neutral photos for Color Grade

`scripts/content/movies/color-grade.mts` regrades one of these photos to each day's film look
(stage 2 of Color Grade), so players see the film's colour without any of its content. Put the
photos here as `*.jpg`.

A good neutral photo:

- is an ordinary scene (a street, a park, a kitchen, a beach) with **no people's faces, no text
  and nothing film-like** in it;
- is evenly lit daylight with a **balanced white point**: whites look white, grays look gray;
- has a **spread of colours and tones** (sky, foliage, painted walls, shadows and highlights),
  because the transfer can only reshape colour that's there;
- is at least **1280×720** and roughly landscape (it's centre-cropped to 16:9);
- is one **you have the rights to** (your own photo, or CC0).

Five to ten photos are plenty; the pipeline picks one per day. They're re-encoded on the way into
the database and their metadata is stripped.
