use hidapi::{HidApi, MAX_REPORT_DESCRIPTOR_SIZE};
use serde::Serialize;

const X1_VENDOR_ID: u16 = 0x3151;
const X1_PRODUCT_ID: u16 = 0x5031;
const REPORT_ID: u8 = 0x04;
const PAYLOAD_LEN: usize = 56;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HidDiagnostic {
    interface_number: i32,
    usage_page: String,
    usage: String,
    manufacturer: Option<String>,
    product: Option<String>,
    report_descriptor: Option<String>,
    descriptor_error: Option<String>,
    feature_report: Option<String>,
    feature_report_error: Option<String>,
}

pub fn inspect_dpi_hardware() -> Result<Vec<HidDiagnostic>, String> {
    let api = HidApi::new().map_err(|error| format!("Could not initialise HID: {error}"))?;
    let diagnostics = api.device_list()
        .filter(|device| device.vendor_id() == X1_VENDOR_ID && device.product_id() == X1_PRODUCT_ID)
        .map(|device| {
            let (report_descriptor, descriptor_error, feature_report, feature_report_error) = match device.open_device(&api) {
                Ok(handle) => {
                    let mut descriptor = [0_u8; MAX_REPORT_DESCRIPTOR_SIZE];
                    let (report_descriptor, descriptor_error) = match handle.get_report_descriptor(&mut descriptor) {
                        Ok(length) => (Some(hex(&descriptor[..length])), None),
                        Err(error) => (None, Some(format!("Could not read report descriptor: {error}"))),
                    };

                    // Interface 2 advertises one 64-byte Feature report without a report ID.
                    // hidapi requires a leading 0 byte for unnumbered reports, so the buffer is 65 bytes.
                    let mut feature = [0_u8; 65];
                    let (feature_report, feature_report_error) = match handle.get_feature_report(&mut feature) {
                        Ok(length) => (Some(hex(&feature[..length])), None),
                        Err(error) => (None, Some(format!("Could not read feature report: {error}"))),
                    };

                    (report_descriptor, descriptor_error, feature_report, feature_report_error)
                }
                Err(error) => (None, Some(format!("Could not open interface: {error}")), None, Some(format!("Could not open interface: {error}"))),
            };

            HidDiagnostic {
                interface_number: device.interface_number(),
                usage_page: format!("0x{:04x}", device.usage_page()),
                usage: format!("0x{:04x}", device.usage()),
                manufacturer: device.manufacturer_string().map(str::to_owned),
                product: device.product_string().map(str::to_owned),
                report_descriptor,
                descriptor_error,
                feature_report,
                feature_report_error,
            }
        })
        .collect::<Vec<_>>();

    if diagnostics.is_empty() {
        return Err("Attack Shark X1 (VID 3151, PID 5031) was not found. Connect it by USB or its 2.4 GHz receiver and try again.".into());
    }

    Ok(diagnostics)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn set_dpi(dpi: u16) -> Result<(), String> {
    let dpi = dpi.clamp(50, 40_000);
    let payload = build_payload(dpi);
    let mut report = [0u8; PAYLOAD_LEN + 1];
    report[0] = REPORT_ID;
    report[1..].copy_from_slice(&payload);

    let api = HidApi::new().map_err(|e| format!("Could not initialise HID: {e}"))?;
    let mut candidates = api.device_list()
        .filter(|device| device.vendor_id() == X1_VENDOR_ID && device.product_id() == X1_PRODUCT_ID)
        .map(|device| (device.path().to_owned(), device.interface_number(), device.usage_page()))
        .collect::<Vec<_>>();

    if candidates.is_empty() {
        return Err("Attack Shark X1 HID interface was not found. Connect the mouse by USB or its 2.4 GHz receiver and try again.".into());
    }

    candidates.sort_by_key(|(_, interface, usage_page)| {
        (if *interface == 2 { 0 } else { 1 }, if *usage_page >= 0xff00 { 0 } else { 1 })
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

        // hidapi's send_feature_report returns Result<(), HidError>, not the
        // number of bytes written. A successful call means Windows accepted
        // the complete feature report.
        match device.send_feature_report(&report) {
            Ok(()) => return Ok(()),
            Err(error) => last_error = format!("HID feature report failed: {error}"),
        }
    }

    Err(last_error)
}

fn build_payload(dpi: u16) -> [u8; PAYLOAD_LEN] {
    let mut report = [0u8; PAYLOAD_LEN];
    let dpi = dpi.clamp(50, 40_000);

    report[0] = REPORT_ID;
    report[1] = 0x38;
    report[2] = 0x01;
    report[3] = 0x00;
    report[4] = 0x01;
    report[5] = 0x3f;

    let stages = [dpi, 1600, 2400, 3200, 5000, 8000];
    let mut stage_mask = 0u8;
    for (index, stage_dpi) in stages.iter().enumerate() {
        let (encoded, high) = encode_dpi(*stage_dpi);
        report[8 + index] = encoded;
        report[16 + index] = if high { 1 } else { 0 };
        if *stage_dpi > 12_000 { stage_mask |= 1 << index; }
    }

    report[6] = stage_mask;
    report[7] = stage_mask;
    report[24] = 1;

    let colors = [
        (0xff, 0x00, 0x00), (0x00, 0xff, 0x00), (0x00, 0x00, 0xff),
        (0xff, 0xff, 0x00), (0x00, 0xff, 0xff), (0xff, 0x00, 0xff),
        (0xff, 0x40, 0x00), (0xff, 0xff, 0xff),
    ];
    for (index, (r, g, b)) in colors.iter().enumerate() {
        report[25 + index * 3] = *r;
        report[26 + index * 3] = *g;
        report[27 + index * 3] = *b;
    }

    report[49] = 0x01;
    let checksum: u16 = report[3..50].iter().map(|value| *value as u16).sum();
    report[50] = (checksum >> 8) as u8;
    report[51] = checksum as u8;
    report
}

fn encode_dpi(dpi: u16) -> (u8, bool) {
    let dpi = dpi.clamp(50, 40_000);
    if dpi <= 10_000 {
        let index = (dpi / 50).saturating_sub(1) as usize;
        return (DPI_MAP[index.min(DPI_MAP.len() - 1)], false);
    }

    let dpi = dpi.min(22_000);
    if dpi <= 12_000 {
        let value = 199u16 + ((dpi.saturating_sub(10_100)) / 100);
        return ((value & 0xff) as u8, true);
    }
    if dpi >= 20_100 {
        let value = 199u16 + ((dpi - 20_100) / 100);
        return ((value & 0xff) as u8, true);
    }
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
