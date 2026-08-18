use hidapi::HidApi;

const X1_VENDOR_ID: u16 = 0x3151;
const X1_PRODUCT_ID: u16 = 0x5031;
const REPORT_ID: u8 = 0x04;
const PAYLOAD_LEN: usize = 56;

/// Sends the Attack Shark X1 DPI feature report through its vendor HID interface.
///
/// The X1 uses the same 0x04/0x38 DPI packet family as the closely related
/// Attack Shark mice: six DPI stages, stage masks, an active-stage byte and a
/// 16-bit checksum. hidapi on Windows expects the HID report ID as the first
/// byte of the buffer, so the 56-byte protocol payload is sent as a 57-byte
/// buffer with 0x04 prepended.
pub fn set_dpi(dpi: u16) -> Result<(), String> {
    let dpi = dpi.clamp(50, 40_000);
    let payload = build_payload(dpi);
    let mut report = [0u8; PAYLOAD_LEN + 1];
    report[0] = REPORT_ID;
    report[1..].copy_from_slice(&payload);

    let api = HidApi::new().map_err(|e| format!("Could not initialise HID: {e}"))?;

    let mut candidates = api
        .device_list()
        .filter(|device| {
            device.vendor_id() == X1_VENDOR_ID && device.product_id() == X1_PRODUCT_ID
        })
        .map(|device| {
            (
                device.path().to_owned(),
                device.interface_number(),
                device.usage_page(),
            )
        })
        .collect::<Vec<_>>();

    if candidates.is_empty() {
        return Err(
            "Attack Shark X1 HID interface was not found. Connect the mouse by USB or its 2.4 GHz receiver and try again."
                .into(),
        );
    }

    // Configuration reports normally live on interface 2. Prefer a
    // vendor-defined usage page as an additional guard against opening the
    // normal mouse/keyboard HID interface.
    candidates.sort_by_key(|(_, interface, usage_page)| {
        let interface_score = if *interface == 2 { 0 } else { 1 };
        let vendor_score = if *usage_page >= 0xff00 { 0 } else { 1 };
        (interface_score, vendor_score)
    });

    let mut last_error = String::from("No compatible X1 HID interface accepted the DPI report.");

    for (path, _, _) in candidates {
        let device = match api.open_path(&path) {
            Ok(device) => device,
            Err(error) => {
                last_error = format!("Could not open X1 HID interface: {error}");
                continue;
            }
        };

        // On Windows, HidD_SetFeature wants the report ID included in the
        // buffer. This is the important difference from the raw USB control
        // transfer representation, where the 56-byte payload starts with 0x04.
        match device.send_feature_report(&report) {
            Ok(written) if written >= report.len() => return Ok(()),
            Ok(written) => {
                last_error = format!("X1 accepted only {written} of {} HID report bytes", report.len());
            }
            Err(error) => {
                last_error = format!("HID feature report failed: {error}");
            }
        }
    }

    Err(last_error)
}

fn build_payload(dpi: u16) -> [u8; PAYLOAD_LEN] {
    let mut report = [0u8; PAYLOAD_LEN];
    let dpi = dpi.clamp(50, 40_000);

    // Protocol header. The report ID itself is supplied separately by hidapi.
    report[0] = 0x04;
    report[1] = 0x38; // 56-byte payload
    report[2] = 0x01;
    report[3] = 0x00; // angle snap off
    report[4] = 0x01; // ripple control on
    report[5] = 0x3f; // six active stages

    // Keep all six stages valid because the device stores the complete table
    // when a DPI feature report is written. Stage 1 is the value requested by
    // the app and is also the active stage.
    let stages = [dpi, 1600, 2400, 3200, 5000, 8000];
    let mut stage_mask = 0u8;

    for (index, stage_dpi) in stages.iter().enumerate() {
        let (encoded, high) = encode_dpi(*stage_dpi);
        report[8 + index] = encoded;
        report[16 + index] = if high { 1 } else { 0 };

        // The protocol uses the duplicated mask at offsets 6 and 7 when the
        // stage is above 12,000 DPI.
        if *stage_dpi > 12_000 {
            stage_mask |= 1 << index;
        }
    }

    report[6] = stage_mask;
    report[7] = stage_mask;
    report[24] = 1; // active stage 1

    // The remaining bytes are preserved as the standard DPI-stage colour /
    // protocol fields used by the Attack Shark family. They are harmless for
    // the X1 but keeping them populated avoids sending an all-zero tail.
    let colors = [
        (0xff, 0x00, 0x00),
        (0x00, 0xff, 0x00),
        (0x00, 0x00, 0xff),
        (0xff, 0xff, 0x00),
        (0x00, 0xff, 0xff),
        (0xff, 0x00, 0xff),
        (0xff, 0x40, 0x00),
        (0xff, 0xff, 0xff),
    ];
    for (index, (r, g, b)) in colors.iter().enumerate() {
        report[25 + index * 3] = *r;
        report[26 + index * 3] = *g;
        report[27 + index * 3] = *b;
    }

    report[49] = 0x01;

    let checksum: u16 = report[3..50]
        .iter()
        .map(|value| *value as u16)
        .sum();
    report[50] = (checksum >> 8) as u8;
    report[51] = checksum as u8;

    report
}

fn encode_dpi(dpi: u16) -> (u8, bool) {
    // The public Attack Shark-family map is defined in 50-DPI increments up
    // to 10,000 DPI. Values above that use the protocol's high-DPI flags.
    let dpi = dpi.clamp(50, 40_000);

    if dpi <= 10_000 {
        let index = (dpi / 50).saturating_sub(1) as usize;
        return (DPI_MAP[index.min(DPI_MAP.len() - 1)], false);
    }

    // This report format only has a well-defined high-range encoding through
    // 22,000 DPI. Keep the command safe for the X1's advertised 40,000 DPI
    // range by clamping unsupported protocol values to the highest known
    // representable value rather than inventing a register encoding.
    let dpi = dpi.min(22_000);

    if dpi <= 12_000 {
        let value = 199u16 + ((dpi.saturating_sub(10_100)) / 100);
        return ((value & 0xff) as u8, true);
    }

    // The second high range (20,100..22,000) uses the same encoded byte range
    // with the high-stage flag selecting the upper bank.
    if dpi >= 20_100 {
        let value = 199u16 + ((dpi - 20_100) / 100);
        return ((value & 0xff) as u8, true);
    }

    // 12,100..20,000 is not representable by this protocol's high flag.
    // Fall back to the nearest valid 10,000-DPI register.
    (DPI_MAP[DPI_MAP.len() - 1], false)
}

const DPI_MAP: [u8; 200] = [
    0x01,0x02,0x03,0x04,0x05,0x06,0x08,0x09,0x0a,0x0b,0x0c,0x0e,0x0f,0x10,0x11,0x12,
    0x13,0x15,0x16,0x17,0x18,0x19,0x1b,0x1c,0x1d,0x1e,0x1f,0x20,0x22,0x23,0x24,0x25,
    0x26,0x27,0x29,0x2a,0x2b,0x2c,0x2d,0x2f,0x30,0x31,0x32,0x33,0x34,0x36,0x37,0x38,
    0x39,0x3a,0x3b,0x3d,0x3e,0x3f,0x40,0x41,0x43,0x44,0x45,0x46,0x47,0x48,0x4a,
    0x4b,0x4c,0x4d,0x4e,0x4f,0x51,0x52,0x53,0x54,0x55,0x57,0x58,0x59,0x5a,0x5b,
    0x5c,0x5e,0x5f,0x60,0x61,0x62,0x63,0x65,0x66,0x67,0x68,0x69,0x6b,0x6c,0x6d,
    0x6e,0x6f,0x70,0x72,0x73,0x74,0x75,0x76,0x77,0x79,0x7a,0x7b,0x7c,0x7d,0x7f,
    0x80,0x81,0x82,0x83,0x84,0x86,0x87,0x88,0x89,0x8a,0x8b,0x8d,0x8e,0x8f,0x90,
    0x91,0x93,0x94,0x95,0x96,0x97,0x98,0x9a,0x9b,0x9c,0x9d,0x9e,0x9f,0xa1,0xa2,
    0xa3,0xa4,0xa5,0xa7,0xa8,0xa9,0xaa,0xab,0xac,0xae,0xaf,0xb0,0xb1,0xb2,0xb3,
    0xb5,0xb6,0xb7,0xb8,0xb9,0xbb,0xbc,0xbd,0xbe,0xbf,0xc0,0xc2,0xc3,0xc4,0xc5,
    0xc6,0xc7,0xc9,0xca,0xcb,0xcc,0xcd,0xcf,0xd0,0xd1,0xd2,0xd3,0xd4,0xd6,0xd7,
    0xd8,0xd9,0xda,0xdb,0xdd,0xde,0xdf,0xe0,0xe1,0xe3,0xe4,0xe5,0xe6,0xe7,0xe8,
    0xea,0xeb,
];
