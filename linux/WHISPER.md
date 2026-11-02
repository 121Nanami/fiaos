# Local transcription (whisper.cpp)

FiaOS does not download a model. When you want a transcript of a file already in the media library:

1. Build or install [whisper.cpp](https://github.com/ggml-org/whisper.cpp) so `whisper-cli` is on `PATH`, or set `WHISPER_BIN` to the binary.
2. Download a model yourself and set `WHISPER_MODEL` to that file (for example `ggml-small.bin`).
3. Put the audio in the media folder (`$FIAOS_DATA/media` or `FIAOS_MEDIA`).
4. `POST /api/local/transcribe` with `{"file":"<name>"}` and header `X-FiaOS: 1`.

If either variable is missing, the route returns a stub and does not invent a transcript. The file must stay inside the media folder.
