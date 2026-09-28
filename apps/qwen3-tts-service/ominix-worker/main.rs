use std::env;
use std::fs;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

use qwen3_tts_mlx::{save_wav, SynthesizeOptions, Synthesizer};
use serde::{Deserialize, Serialize};

const BASELINE: &str = "理性的で、落ち着いていて知的、自信のある話し方。自然で控えめに話し、少し辛口で乾いたユーモアを含める。軽いツンデレの、素直に心配を認めたがらない雰囲気を保つ。無理に萌え声にしたり、大げさなアニメ演技や決まり文句を繰り返したりしない。";

#[derive(Deserialize)]
struct Request {
    text: String,
    emotion: String,
    output: String,
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
}

fn arg(name: &str) -> Result<PathBuf, String> {
    let args: Vec<String> = env::args().collect();
    let pos = args.iter().position(|v| v == name).ok_or_else(|| format!("missing_{name}"))?;
    args.get(pos + 1).map(PathBuf::from).ok_or_else(|| format!("missing_{name}_value"))
}

fn instruct(emotion: &str) -> Result<String, &'static str> {
    let delta = match emotion {
        "default" => "",
        "irritated" => "少し苛立ちと軽い叱責を強めるが、冷静さは保つ。",
        "embarrassed" => "照れと戸惑いを隠そうとし、少しためらうように話す。",
        "angry" => "明確に怒った鋭い話し方にするが、通常は叫ばず抑制する。",
        "sarcastic" => "乾いた皮肉と軽いからかいを含め、抑えた嘲笑の調子にする。",
        "soft" => "気遣いと慰めを込め、少し柔らかく話すが、控えめな個性は保つ。",
        "sad" => "抑えた悲しみをにじませ、少し低くゆっくり話す。",
        _ => return Err("invalid_emotion"),
    };
    Ok(format!("{BASELINE}{delta}"))
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
    // The model and reference waveform remain resident in this one process;
    // extract the x-vector once; no per-request model/CLI startup or second
    // fallback engine is possible.
    let mut synthesizer = Synthesizer::load(&model)?;
    synthesizer.cache_speaker_embedding(&reference_audio)?;
    emit(&Ready { ready: true, model: "qwen3-tts-1.7b", reference_cached: true })?;
    for line in io::stdin().lock().lines() {
        let request: Request = match line.and_then(|line| serde_json::from_str(&line).map_err(io::Error::other)) {
            Ok(request) => request,
            Err(_) => { emit(&Response { ok: false, error: Some("invalid_request"), sample_rate: None, timing_ms: None })?; continue; }
        };
        let output = Path::new(&request.output);
        if output.parent() != Some(output_dir.as_path()) || request.text.is_empty() || request.text.chars().count() > 1200 {
            emit(&Response { ok: false, error: Some("invalid_request"), sample_rate: None, timing_ms: None })?;
            continue;
        }
        let style = match instruct(&request.emotion) {
            Ok(style) => style,
            Err(error) => { emit(&Response { ok: false, error: Some(error), sample_rate: None, timing_ms: None })?; continue; }
        };
        let started = Instant::now();
        let options = SynthesizeOptions { language: "japanese", ..Default::default() };
        match synthesizer.synthesize_voice_clone_instruct_with_timing(&request.text, &reference_audio, &style, "japanese", &options) {
            Ok((samples, timing)) if !samples.is_empty() => {
                save_wav(&samples, synthesizer.sample_rate, output)?;
                emit(&Response { ok: true, error: None, sample_rate: Some(synthesizer.sample_rate), timing_ms: Some(timing.total_ms.max(started.elapsed().as_secs_f64() * 1000.0)) })?;
            }
            Ok(_) => emit(&Response { ok: false, error: Some("empty_audio"), sample_rate: None, timing_ms: None })?,
            Err(_) => emit(&Response { ok: false, error: Some("synthesis_failed"), sample_rate: None, timing_ms: None })?,
        }
    }
    Ok(())
}
