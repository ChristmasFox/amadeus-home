use std::env;
use std::fs;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

use qwen3_tts_mlx::{save_wav, SynthesizeOptions, Synthesizer};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct Request {
    text: String,
    emotion: String,
    output: String,
    #[serde(default)]
    instruct: Option<String>,
    #[serde(default)]
    options: Option<Options>,
}

#[derive(Deserialize, Default)]
struct Options {
    temperature: Option<f32>,
    top_k: Option<i32>,
    top_p: Option<f32>,
    max_new_tokens: Option<i32>,
    seed: Option<u64>,
    speed_factor: Option<f32>,
    repetition_penalty: Option<f32>,
}

#[derive(Serialize)]
struct Ready<'a> {
    ready: bool,
    model: &'a str,
    reference_cached: bool,
}

#[derive(Serialize)]
struct Response<'a> {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'a str>,
    #[serde(rename = "sampleRate", skip_serializing_if = "Option::is_none")]
    sample_rate: Option<u32>,
    #[serde(rename = "timingMs", skip_serializing_if = "Option::is_none")]
    timing_ms: Option<f64>,
    #[serde(rename = "prefillMs", skip_serializing_if = "Option::is_none")]
    prefill_ms: Option<f64>,
    #[serde(rename = "generationMs", skip_serializing_if = "Option::is_none")]
    generation_ms: Option<f64>,
    #[serde(rename = "decodeMs", skip_serializing_if = "Option::is_none")]
    decode_ms: Option<f64>,
    #[serde(rename = "generationFrames", skip_serializing_if = "Option::is_none")]
    generation_frames: Option<usize>,
}

fn response_error(error: &'static str) -> Response<'static> {
    Response { ok: false, error: Some(error), sample_rate: None, timing_ms: None, prefill_ms: None, generation_ms: None, decode_ms: None, generation_frames: None }
}

fn arg(name: &str) -> Result<PathBuf, String> {
    let args: Vec<String> = env::args().collect();
    let pos = args.iter().position(|v| v == name).ok_or_else(|| format!("missing_{name}"))?;
    args.get(pos + 1).map(PathBuf::from).ok_or_else(|| format!("missing_{name}_value"))
}

fn emit<T: Serialize>(value: &T) -> io::Result<()> {
    let mut out = io::BufWriter::new(io::stdout().lock());
    serde_json::to_writer(&mut out, value)?;
    out.write_all(b"\n")?;
    out.flush()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let model = arg("--model")?;
    let reference = arg("--reference")?;
    let output_dir = arg("--output-dir")?;
    fs::create_dir_all(&output_dir)?;
    let (mut reference_audio, reference_rate) = mlx_rs_core::audio::load_wav(&reference)?;
    if reference_rate != 24_000 {
        reference_audio = mlx_rs_core::audio::resample(&reference_audio, reference_rate, 24_000);
    }
    // One resident Base model and one cached x-vector are shared by production
    // and the loopback lab API. No request can replace either identity.
    let mut synthesizer = Synthesizer::load(&model)?;
    synthesizer.cache_speaker_embedding(&reference_audio)?;
    emit(&Ready { ready: true, model: "qwen3-tts-1.7b", reference_cached: true })?;
    for line in io::stdin().lock().lines() {
        let request: Request = match line.and_then(|line| serde_json::from_str(&line).map_err(io::Error::other)) {
            Ok(request) => request,
            Err(_) => { emit(&response_error("invalid_request"))?; continue; }
        };
        let output = Path::new(&request.output);
        if output.parent() != Some(output_dir.as_path()) || request.text.is_empty() || request.text.chars().count() > 1200 {
            emit(&response_error("invalid_request"))?;
            continue;
        }
        if !matches!(request.emotion.as_str(), "default" | "irritated" | "embarrassed" | "angry" | "sarcastic" | "soft" | "sad") {
            emit(&response_error("invalid_emotion"))?;
            continue;
        }
        let style = request.instruct.unwrap_or_default();
        let opts = request.options.unwrap_or_default();
        let started = Instant::now();
        let options = SynthesizeOptions {
            speaker: "vivian",
            language: "japanese",
            temperature: opts.temperature,
            top_k: opts.top_k,
            top_p: opts.top_p,
            max_new_tokens: opts.max_new_tokens,
            seed: opts.seed,
            speed_factor: opts.speed_factor,
            repetition_penalty: opts.repetition_penalty,
        };
        match synthesizer.synthesize_voice_clone_instruct_with_timing(&request.text, &reference_audio, &style, "japanese", &options) {
            Ok((samples, timing)) if !samples.is_empty() => {
                save_wav(&samples, synthesizer.sample_rate, output)?;
                emit(&Response { ok: true, error: None, sample_rate: Some(synthesizer.sample_rate), timing_ms: Some(timing.total_ms.max(started.elapsed().as_secs_f64() * 1000.0)), prefill_ms: Some(timing.prefill_ms), generation_ms: Some(timing.generation_ms), decode_ms: Some(timing.decode_ms), generation_frames: Some(timing.generation_frames) })?;
            }
            Ok(_) => emit(&response_error("empty_audio"))?,
            Err(_) => emit(&response_error("synthesis_failed"))?,
        }
    }
    Ok(())
}
