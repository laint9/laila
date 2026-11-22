# Tạo file cài đặt iOS (.mobileconfig, loại Web Clip): cài biểu tượng "Giá Vàng" lên màn hình chính,
# mở app toàn màn hình. Không cần Mac, không cần tài khoản Apple Developer.
# Dùng: python3 scripts/make-mobileconfig.py <URL app> <file ra>
import base64, plistlib, sys, uuid, os

url = sys.argv[1] if len(sys.argv) > 1 else 'https://laint9.github.io/laila/'
out = sys.argv[2] if len(sys.argv) > 2 else 'web/GiaVang.mobileconfig'
here = os.path.dirname(os.path.abspath(__file__))
icon = open(os.path.join(here, '..', 'web', 'icons', 'icon-180.png'), 'rb').read()

# UUID cố định theo URL để cài lại sẽ thay bản cũ thay vì tạo biểu tượng trùng
ns = uuid.uuid5(uuid.NAMESPACE_URL, url)
clip = {
    'PayloadType': 'com.apple.webClip.managed',
    'PayloadVersion': 1,
    'PayloadIdentifier': 'vn.giavang.webclip',
    'PayloadUUID': str(uuid.uuid5(ns, 'clip')).upper(),
    'PayloadDisplayName': 'Giá Vàng',
    'Label': 'Giá Vàng',
    'URL': url,
    'Icon': icon,
    'IsRemovable': True,
    'FullScreen': True,
    'Precomposed': True,
    'IgnoreManifestScope': False,
}
profile = {
    'PayloadType': 'Configuration',
    'PayloadVersion': 1,
    'PayloadIdentifier': 'vn.giavang.profile',
    'PayloadUUID': str(uuid.uuid5(ns, 'profile')).upper(),
    'PayloadDisplayName': 'Giá Vàng 999',
    'PayloadDescription': 'Thêm app Giá Vàng 999 (giá vàng thế giới và Việt Nam) vào màn hình chính.',
    'PayloadOrganization': 'Giá Vàng 999',
    'PayloadRemovalDisallowed': False,
    'PayloadContent': [clip],
}
with open(out, 'wb') as f:
    plistlib.dump(profile, f, fmt=plistlib.FMT_XML)
print('Đã tạo', out, '→', url)
