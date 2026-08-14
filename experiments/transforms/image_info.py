from PIL import Image
import numpy as np

img = Image.open("../../images/character.png")
arr = np.array(img)

print("Shape:", arr.shape)
print("Mode:", img.mode)
print("Size:", img.size)
print("Top-left pixel:", arr[0, 0])
print("Center pixel:", arr[arr.shape[0]//2, arr.shape[1]//2])
print("Min value:", arr.min(), "Max value:", arr.max())
print("Total pixels:", arr.shape[0] * arr.shape[1])
