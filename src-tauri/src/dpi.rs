use hidapi::{HidApi, MAX_REPORT_DESCRIPTOR_SIZE};
use serde::Serialize;

const X1_VENDOR_ID: u16 = 0x3151;
const X1_PRODUCT_ID: u16 = 0x5031;
const WIRED_X1_VENDOR_ID: u16 = 0x1d57;
const WIRED_X1_PRODUCT_IDS: [u16; 2] = [0xfa60, 0xfa65];
const WIRED_X1_PRODUCT_ID: u16 = 0x5032;
const HID_FEATURE_DATA_LEN: usize = 64;
const CONFIG_INTERFACE: i32 = 2;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HidDiagnostic {
    vendor_id: String,
    product_id: String,
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
        .filter(|device| {
            let product = device.product_string().unwrap_or_default().to_ascii_lowercase();
            (device.vendor_id() == X1_VENDOR_ID
                    && (device.product_id() == X1_PRODUCT_ID
                        || device.product_id() == WIRED_X1_PRODUCT_ID))
                || (device.vendor_id() == WIRED_X1_VENDOR_ID
                    && WIRED_X1_PRODUCT_IDS.contains(&device.product_id()))
                || product.contains("mouse")
                || device.usage_page() == 0xffff
        })
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
                vendor_id: format!("0x{:04x}", device.vendor_id()),
                product_id: format!("0x{:04x}", device.product_id()),
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
        return Err("No mouse or vendor HID interfaces were found. Connect the mouse and try again.".into());
    }

    Ok(diagnostics)
}

pub fn read_x1_battery() -> Result<Option<u8>, String> {
    let api = HidApi::new().map_err(|error| format!("Could not initialize HID: {error}"))?;
    let path = api
        .device_list()
        .find(|device| {
            device.vendor_id() == X1_VENDOR_ID
                && (device.product_id() == X1_PRODUCT_ID
                    || device.product_id() == WIRED_X1_PRODUCT_ID)
                && device.interface_number() == CONFIG_INTERFACE
                && device.usage_page() == 0xffff
                && device.usage() == 0x0002
        })
        .map(|device| device.path().to_owned());

    let Some(path) = path else {
        return Ok(None);
    };

    let device = api
        .open_path(&path)
        .map_err(|error| format!("Could not open the X1 status interface: {error}"))?;
    let mut feature = [0_u8; HID_FEATURE_DATA_LEN + 1];
    let length = device
        .get_feature_report(&mut feature)
        .map_err(|error| format!("Could not read the X1 status report: {error}"))?;

    // On the X1's unnumbered status report, the observed fourth byte is the
    // battery percentage (for example, 0x5a reports 90%). Only surface values
    // that fit a normal percentage; any unknown report layout stays hidden.
    Ok((length > 3).then_some(feature[3]).filter(|value| (1..=100).contains(value)))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn set_dpi(dpi: u16) -> Result<(), String> {
    if !(50..=40_000).contains(&dpi) {
        return Err("DPI must be between 50 and 40,000.".to_string());
    }

    let data = build_qmk_dpi_report(dpi);
    // The X1 uses an unnumbered 64-byte Feature report. hidapi requires a
    // leading report-ID byte, so the zero at index 0 represents “unnumbered”.
    let mut report = [0u8; HID_FEATURE_DATA_LEN + 1];
    report[1..].copy_from_slice(&data);

    let api = HidApi::new().map_err(|error| format!("Could not initialize HID: {error}"))?;
    let path = api
        .device_list()
        .find(|device| {
            device.vendor_id() == X1_VENDOR_ID
                && (device.product_id() == X1_PRODUCT_ID
                    || device.product_id() == WIRED_X1_PRODUCT_ID)
                && device.interface_number() == CONFIG_INTERFACE
                && device.usage_page() == 0xffff
                && device.usage() == 0x0002
        })
        .map(|device| device.path().to_owned())
        .ok_or_else(|| {
            "Mouse configuration interface was not found. Connect the X1 by USB-C or its receiver and try again.".to_string()
        })?;

    let device = api
        .open_path(&path)
        .map_err(|error| format!("Could not open the mouse configuration interface: {error}"))?;

    device
        .send_feature_report(&report)
        .map_err(|error| format!("Could not send the DPI configuration to the mouse: {error}"))?;

    Ok(())
}

fn build_qmk_dpi_report(dpi: u16) -> [u8; HID_FEATURE_DATA_LEN] {
    // Captured from qmk.top’s working X1 SendFeatureReport request. The first
    // DPI stage is stored twice (X/Y) as a little-endian u16 at offsets 8 and 24.
    let mut report = [
        0x54, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0xa5,
        0xb0, 0x1d, 0x60, 0x09, 0x80, 0x0c, 0xe0, 0x15,
        0x40, 0x1f, 0x40, 0x9c, 0x00, 0x00, 0x00, 0x00,
        0xb0, 0x1d, 0x60, 0x09, 0x80, 0x0c, 0xe0, 0x15,
        0x40, 0x1f, 0x40, 0x9c, 0x00, 0x00, 0x00, 0x00,
        0xff, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00,
        0xff, 0xff, 0xff, 0x00, 0x00, 0xff, 0xff, 0x80,
        0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ];

    let dpi = dpi.to_le_bytes();
    report[8..10].copy_from_slice(&dpi);
    report[24..26].copy_from_slice(&dpi);
    report
}
