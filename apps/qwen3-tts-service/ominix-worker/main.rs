use std::env;
use std::fs;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

use qwen3_tts_mlx::{save_wav, SynthesizeOptions, Synthesizer};
use serde::{Deserialize, Serialize};

const BASELINE: &str = "理性的で知的、芯のある女性の声。文ごとに自然な音高と抑揚をつけ、重要な語を軽く強調する。意味の対比ではリズムと声のエネルギーを変える。普段は少し鋭く素っ気なく始めるが、気遣いが表れる箇所では声と語尾をわずかに柔らげる、識別しやすいツンデレ調。自然な会話として話し、アニメ声、叫び声、甘すぎる声、接客口調にはしない。";

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
        "irritated" => "語頭と重要な叱責語をやや鋭くし、短い間を置いて少し速く続ける。文末はきっぱり切る。",
        "embarrassed" => "最初は尖った返しで始め、照れが出る語の前に短い間を置く。後半は少し速くなり、文末を弱く柔らげる。",
        "angry" => "声のエネルギーと子音の鋭さを上げ、重要語を強く置いて短く区切る。文末は硬くするが、叫ばない。",
        "sarcastic" => "皮肉の語を軽く強調し、その前後に短い間を置く。テンポは軽く、文末を少し引いて乾いたからかいを伝える。",
        "soft" => "声のエネルギーを下げ、安心させる語を柔らかく強調する。間を少し長くし、文末を丸くするが、最初の素っ気なさは残す。",
        "sad" => "音高を少し下げ、速度とエネルギーを落とす。重要語の前に長めの間を置き、文末を弱く余韻で終える。",
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
