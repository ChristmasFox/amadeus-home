#!/usr/bin/env python3
"""Apply the one reviewed OminiX cache patch at the pinned source revision."""
from __future__ import annotations

from pathlib import Path
import sys

MARKER = "amadeus-kurisu-cached-x-vector-v1"


def once(source: str, before: str, after: str, label: str) -> str:
    count = source.count(before)
    if count != 1:
        raise SystemExit(f"{label}_anchor_count={count}")
    return source.replace(before, after)


def patch(path: Path) -> None:
    source = path.read_text()
    if MARKER in source:
        return
    source = once(
        source,
        "    pub speech_encoder: Option<speech_encoder::SpeechEncoder>,\n",
        "    pub speech_encoder: Option<speech_encoder::SpeechEncoder>,\n"
        "    /// Cached Base x-vector extracted once from the Kurisu reference audio.\n"
        "    pub cached_speaker_embedding: Option<mlx_rs::Array>,\n",
        "cached field",
    )
    source = once(
        source,
        "            speech_encoder: spch_encoder,\n",
        "            speech_encoder: spch_encoder,\n            cached_speaker_embedding: None,\n",
        "load cache initialization",
    )
    source = once(
        source,
        "        self.speech_encoder = None;\n",
        "        self.speech_encoder = None;\n        self.cached_speaker_embedding = None;\n",
        "swap cache reset",
    )
    function = "pub fn synthesize_voice_clone_instruct_with_timing("
    head, tail = source.split(function, 1)
    old_encoder = """        let spk_encoder = self.speaker_encoder.as_mut().ok_or_else(|| {
            Error::Model(\"Voice cloning requires a Base model with speaker encoder\".into())
        })?;

"""
    tail = once(tail, old_encoder, "", "instruct encoder borrow")
    old_compute = """        // Compute speaker embedding
        info!(\"Computing speaker embedding from reference audio ({} samples)...\", reference_audio.len());
        let mel_config = speaker_encoder::SpeakerMelConfig::default();
        let mel = speaker_encoder::compute_speaker_mel(reference_audio, &mel_config)?;
        let speaker_embedding = spk_encoder.forward(&mel)?;
        mlx_rs::transforms::eval(std::iter::once(&speaker_embedding))?;

"""
    new_compute = """        // The worker extracts this x-vector once during startup and reuses it.
        let speaker_embedding = self.cached_speaker_embedding.as_ref().ok_or_else(|| {
            Error::Model(\"Voice cloning speaker embedding is not cached\".into())
        })?;

"""
    tail = once(tail, old_compute, new_compute, "instruct embedding computation")
    source = head + function + tail
    cache_method = """    /// Extract and retain the Base speaker x-vector for a resident voice worker.
    pub fn cache_speaker_embedding(&mut self, reference_audio: &[f32]) -> Result<()> {
        let spk_encoder = self.speaker_encoder.as_mut().ok_or_else(|| {
            Error::Model("Voice cloning requires a Base model with speaker encoder".into())
        })?;
        let mel_config = speaker_encoder::SpeakerMelConfig::default();
        let mel = speaker_encoder::compute_speaker_mel(reference_audio, &mel_config)?;
        let speaker_embedding = spk_encoder.forward(&mel)?;
        mlx_rs::transforms::eval(std::iter::once(&speaker_embedding))?;
        self.cached_speaker_embedding = Some(speaker_embedding);
        Ok(())
    }

"""
    source = once(source, "    pub fn synthesize_voice_clone(\n", cache_method + "    pub fn synthesize_voice_clone(\n", "cache method insertion")
    source = f"// {MARKER}\n" + source
    path.write_text(source)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch-ominix-source.py PATH_TO_QWEN3_TTS_MLX")
    patch(Path(sys.argv[1]) / "src/lib.rs")
