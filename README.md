At a binary level an image file is just bytes. But what those bytes present: 
  

**A grid of pixels.** That’s it fundamentally. Each pixel is a color value. In RGB, that’s 3 numbers (red, green, blue) each 0-255. So a 1920x1080  image is simply:

  ```txt
  1920 × 1080 × 3 = 6,220,800 bytes of raw color data 
  ```
What the file format adds on top:
**Header** — width, height, color depth, format metadata
**Compression** — PNG is lossless, JPEG is lossy (throws away data your eye won't notice)
**Color space info** — sRGB, linear, etc.
**Alpha channel** — a 4th value per pixel (transparency), RGBA


**In numpy** terms (which is how you'll be working with it):

```python
from PIL import Image
import numpy as np

img = np.array(Image.open("sprite.png"))
print(img.shape)  # (height, width, 4) for RGBA
print(img[0, 0])  # [R, G, B, A] of top-left pixel
```
## Why this matters for this tool:
 When you rig a character, you're not moving pixels directly — you're moving the coordinate space those pixels are mapped onto. The pixels themselves never change, only their position in the world does.
### Test Subject 

```python
from PIL import Image
import numpy as np

img = Image.open("character.png")
arr = np.array(img)

print("Shape:", arr.shape)
print("Mode:", img.mode)
print("Size:", img.size)
print("Top-left pixel:", arr[0, 0])
print("Center pixel:", arr[arr.shape[0]//2, arr.shape[1]//2])
print("Min value:", arr.min(), "Max value:", arr.max())
print("Total pixels:", arr.shape[0] * arr.shape[1])

```
