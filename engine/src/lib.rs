use shanten_dp::{Mode, calc_shanten2};

/// Decode base-five suit counts without exposing WASM memory or allocation to JS.
fn unpack(suits: [u32; 4]) -> [u8; 34] {
    let mut counts = [0; 34];
    for (suit, mut value) in suits.into_iter().enumerate() {
        for rank in 0..if suit == 3 { 7 } else { 9 } {
            counts[suit * 9 + rank] = (value % 5) as u8;
            value /= 5;
        }
    }
    counts
}

/// Return (shanten + 1) in the high bits and the 34-bit effective-tile mask below.
/// -1 means no reachable completion; -2 means invalid library input.
/// m counts the melds still needed in the concealed hand, not the open melds.
#[unsafe(no_mangle)]
pub extern "C" fn analyze(
    hm: u32, hp: u32, hs: u32, hz: u32,
    lm: u32, lp: u32, ls: u32, lz: u32,
    m: u32,
) -> i64 {
    let hand = unpack([hm, hp, hs, hz]);
    let mut limits = [0; 35];
    limits[..34].copy_from_slice(&unpack([lm, lp, ls, lz]));
    match calc_shanten2(&hand, &limits, m as usize, Mode::all(), false, true) {
        Ok(Some(data)) => ((data.shanten as i64 + 1) << 34) | data.waits as i64,
        Ok(None) => -1,
        Err(_) => -2,
    }
}
