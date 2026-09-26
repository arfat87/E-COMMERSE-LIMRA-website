"""
Generates production-grade application icons from the master logo image:
- Windows Desktop icon (.ico) with multi-resolution layers
- Desktop PNG icons (512x512, 256x256)
- Android App Mipmap launcher icons (mdpi, hdpi, xhdpi, xxhdpi, xxxhdpi)
- Web favicons and Apple touch icons
"""

import os
from PIL import Image

def generate_icons():
    master_logo_path = 'frontend/public/images/logo.png'
    if not os.path.exists(master_logo_path):
        raise FileNotFoundError(f"Master logo not found at {master_logo_path}")

    # Load master 1024x1024 image
    img = Image.open(master_logo_path).convert('RGBA')
    print(f"Loaded master logo: {img.size} ({img.mode})")

    # Ensure output directories exist
    os.makedirs('electron', exist_ok=True)
    os.makedirs('build', exist_ok=True)
    os.makedirs('frontend/public', exist_ok=True)

    # 1. Desktop Windows Multi-Resolution ICO
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    
    img.save('electron/icon.ico', format='ICO', sizes=ico_sizes)
    img.save('build/icon.ico', format='ICO', sizes=ico_sizes)
    img.save('frontend/public/favicon.ico', format='ICO', sizes=[(16, 16), (32, 32), (48, 48)])
    print("  ✓ Generated Windows ICOs (electron/icon.ico, build/icon.ico, frontend/public/favicon.ico)")

    # 2. Desktop High-Res PNG icons
    img_512 = img.resize((512, 512), Image.Resampling.LANCZOS)
    img_512.save('electron/icon.png', 'PNG')
    img_512.save('build/icon.png', 'PNG')

    img_256 = img.resize((256, 256), Image.Resampling.LANCZOS)
    img_256.save('electron/icon-256.png', 'PNG')
    print("  ✓ Generated Desktop PNG icons (electron/icon.png, build/icon.png)")

    # 3. Web Favicons
    img_192 = img.resize((192, 192), Image.Resampling.LANCZOS)
    img_192.save('frontend/public/favicon.png', 'PNG')

    img_180 = img.resize((180, 180), Image.Resampling.LANCZOS)
    img_180.save('frontend/public/apple-touch-icon.png', 'PNG')
    print("  ✓ Generated Web icons (favicon.png, apple-touch-icon.png)")

    # 4. Android App Launcher Mipmaps
    android_res = 'android/app/src/main/res'
    if os.path.exists(android_res):
        android_densities = {
            'mipmap-mdpi': (48, 108),
            'mipmap-hdpi': (72, 162),
            'mipmap-xhdpi': (96, 216),
            'mipmap-xxhdpi': (144, 324),
            'mipmap-xxxhdpi': (192, 432),
        }

        for folder, (launcher_size, foreground_size) in android_densities.items():
            dir_path = os.path.join(android_res, folder)
            os.makedirs(dir_path, exist_ok=True)

            # Standard launcher icon
            launcher_img = img.resize((launcher_size, launcher_size), Image.Resampling.LANCZOS)
            launcher_img.save(os.path.join(dir_path, 'ic_launcher.png'), 'PNG')
            launcher_img.save(os.path.join(dir_path, 'ic_launcher_round.png'), 'PNG')

            # Adaptive foreground icon
            foreground_img = img.resize((foreground_size, foreground_size), Image.Resampling.LANCZOS)
            foreground_img.save(os.path.join(dir_path, 'ic_launcher_foreground.png'), 'PNG')

        print("  ✓ Generated Android Mipmap icons for all densities (mdpi to xxxhdpi)")

    print("\nAll application icons successfully created from your logo!")

if __name__ == '__main__':
    generate_icons()
