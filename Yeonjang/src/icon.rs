use std::fs::File;
use std::io::{BufWriter, Cursor};
use std::path::Path;

use anyhow::{Result, anyhow};

const NOBIE_ICON_PNG: &[u8] = include_bytes!("../../resource/nobie-1-128.png");
const APP_ICON_SIZE: u32 = 128;
const APP_ICON_PADDING: u32 = 6;
const APP_ICON_ALPHA_THRESHOLD: u8 = 8;

pub fn build_icon_rgba() -> Result<(Vec<u8>, u32, u32)> {
    let (source_rgba, source_width, source_height) = decode_icon_png_rgba(NOBIE_ICON_PNG)?;
    Ok(fit_icon_to_square(
        &source_rgba,
        source_width,
        source_height,
        APP_ICON_SIZE,
    ))
}

pub fn write_bundle_icon_png(path: &Path) -> Result<()> {
    let (rgba, width, height) = build_icon_rgba()?;
    let file = File::create(path)?;
    let writer = BufWriter::new(file);
    let mut encoder = png::Encoder::new(writer, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut png_writer = encoder.write_header()?;
    png_writer.write_image_data(&rgba)?;
    Ok(())
}

fn decode_icon_png_rgba(bytes: &[u8]) -> Result<(Vec<u8>, u32, u32)> {
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info()?;
    let mut buffer = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buffer)?;
    let frame = &buffer[..info.buffer_size()];

    let rgba = match info.color_type {
        png::ColorType::Rgba => frame.to_vec(),
        png::ColorType::Rgb => frame
            .chunks_exact(3)
            .flat_map(|pixel| [pixel[0], pixel[1], pixel[2], 255])
            .collect(),
        png::ColorType::GrayscaleAlpha => frame
            .chunks_exact(2)
            .flat_map(|pixel| [pixel[0], pixel[0], pixel[0], pixel[1]])
            .collect(),
        png::ColorType::Grayscale => frame
            .iter()
            .flat_map(|value| [*value, *value, *value, 255])
            .collect(),
        png::ColorType::Indexed => {
            return Err(anyhow!(
                "Indexed PNG icons must be expanded before icon decoding"
            ));
        }
    };

    Ok((rgba, info.width, info.height))
}

fn fit_icon_to_square(
    source_rgba: &[u8],
    source_width: u32,
    source_height: u32,
    size: u32,
) -> (Vec<u8>, u32, u32) {
    let target_width = size;
    let target_height = size;
    let (crop_x, crop_y, crop_width, crop_height) = find_visible_icon_bounds(
        source_rgba,
        source_width,
        source_height,
    )
    .unwrap_or((0, 0, source_width, source_height));
    let content_size = size.saturating_sub(APP_ICON_PADDING * 2).max(1);
    let scale =
        (content_size as f32 / crop_width as f32).min(content_size as f32 / crop_height as f32);
    let fitted_width = ((crop_width as f32 * scale).round() as u32)
        .max(1)
        .min(content_size);
    let fitted_height = ((crop_height as f32 * scale).round() as u32)
        .max(1)
        .min(content_size);
    let offset_x = (size - fitted_width) / 2;
    let offset_y = (size - fitted_height) / 2;
    let mut target = vec![0; (target_width * target_height * 4) as usize];

    for y in 0..fitted_height {
        for x in 0..fitted_width {
            let source_x = crop_x + (x as u64 * crop_width as u64 / fitted_width as u64) as u32;
            let source_y = crop_y + (y as u64 * crop_height as u64 / fitted_height as u64) as u32;
            let source_index = ((source_y * source_width + source_x) * 4) as usize;
            let target_index = (((y + offset_y) * target_width + (x + offset_x)) * 4) as usize;
            target[target_index..target_index + 4]
                .copy_from_slice(&source_rgba[source_index..source_index + 4]);
        }
    }

    (target, target_width, target_height)
}

fn find_visible_icon_bounds(rgba: &[u8], width: u32, height: u32) -> Option<(u32, u32, u32, u32)> {
    let mut min_x = width;
    let mut min_y = height;
    let mut max_x = 0;
    let mut max_y = 0;
    let mut found = false;

    for y in 0..height {
        for x in 0..width {
            let alpha_index = ((y * width + x) * 4 + 3) as usize;
            if rgba.get(alpha_index).copied().unwrap_or(0) <= APP_ICON_ALPHA_THRESHOLD {
                continue;
            }
            found = true;
            min_x = min_x.min(x);
            min_y = min_y.min(y);
            max_x = max_x.max(x);
            max_y = max_y.max(y);
        }
    }

    if found {
        Some((min_x, min_y, max_x - min_x + 1, max_y - min_y + 1))
    } else {
        None
    }
}
