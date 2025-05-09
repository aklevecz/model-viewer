import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import JSZip from "jszip";
import { saveAs } from "file-saver";

export class ModelViewer {
  constructor() {
    this.container = document.getElementById("canvas-container");
    this.normalizationSquare = document.getElementById("normalization-square");
    this.hdrPaths = {
      neutral: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_03_1k.hdr",
      venice: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/venice_sunset_1k.hdr",
      footprint: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/concrete_tunnel_02_1k.hdr",
      cathedral: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/immenstadter_horn_1k.hdr",
      park: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloppenheim_06_1k.hdr",
    };
    this.model = null;
    this.modelBoundingBox = new THREE.Box3();
    this.modelSize = 0;
    this.originalModelPosition = new THREE.Vector3();
    this.environmentMap = null;

    // Normalization properties
    this.squareVisible = false;

    this.init();
    this.setupEventListeners();
    this.animate();
  }

  init() {
    // Scene setup
    this.scene = new THREE.Scene();

    // Camera setup - use a lower FOV for less perspective distortion
    this.camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(5, 2, 5);

    // Renderer setup
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; // Updated from outputEncoding
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.container.appendChild(this.renderer.domElement);

    // Controls - using proper import syntax now
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;

    // Lighting
    this.directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    this.directionalLight.position.set(5, 10, 7.5);
    this.directionalLight.castShadow = true;
    this.scene.add(this.directionalLight);

    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    this.scene.add(this.ambientLight);

    // PMREM generator for HDR maps
    this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);

    // Load default HDR
    this.loadHDR("neutral");

    // Handle window resize
    window.addEventListener("resize", this.onWindowResize.bind(this));
  }

  setupEventListeners() {
    // Model upload
    document.getElementById("model-upload").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          this.loadGLBFromArrayBuffer(event.target.result);
        };
        reader.readAsArrayBuffer(file);
      }
    });

    // HDR selection
    document.getElementById("hdr-selection").addEventListener("change", (e) => {
      this.loadHDR(e.target.value);
    });

    // Exposure control
    document.getElementById("exposure").addEventListener("input", (e) => {
      const value = parseFloat(e.target.value);
      this.renderer.toneMappingExposure = value;
      document.getElementById("exposure-value").textContent = value.toFixed(2);
    });

    // Direct light intensity
    document.getElementById("direct-intensity").addEventListener("input", (e) => {
      const value = parseFloat(e.target.value);
      this.directionalLight.intensity = value;
      document.getElementById("intensity-value").textContent = value.toFixed(1);
    });

    // Direct light color
    document.getElementById("direct-color").addEventListener("input", (e) => {
      this.directionalLight.color.set(e.target.value);
    });

    // Background type
    // document.getElementById("bg-type").addEventListener("change", this.updateBackgroundVisibility.bind(this));
    document.getElementById("bg-type").addEventListener("change", (e) => {
      this.updateBackgroundVisibility();
      this.updateBackgroundPreview(); // Add this line
    });

    // Background color changes
    document.getElementById("bg-color").addEventListener("input", (e) => {
      this.updateBackgroundPreview(); // Add this line
    });

    // Add this to the setupEventListeners method in the ModelViewer class

    // Setup background preset buttons
    document.querySelectorAll(".preset-btn").forEach((button) => {
      button.addEventListener("click", (e) => {
        const bgType = e.target.dataset.type;
        const hdrType = e.target.dataset.hdr;
        const bgColor = e.target.dataset.color;

        // Update the select dropdown
        const bgTypeSelect = document.getElementById("bg-type");
        bgTypeSelect.value = bgType;

        // If it's a color background, update the color picker
        if (bgType === "color" && bgColor) {
          document.getElementById("bg-color").value = bgColor;
        }

        // If it's an environment, load the HDR
        if (bgType === "environment" && hdrType) {
          document.getElementById("hdr-selection").value = hdrType;
          this.loadHDR(hdrType);
        }

        // Update UI and preview
        this.updateBackgroundVisibility();
        this.updateBackgroundPreview();
      });
    });
    // Reset camera
    document.getElementById("reset-camera").addEventListener("click", this.resetCamera.bind(this));

    // Export images
    document.getElementById("export-btn").addEventListener("click", this.exportImages.bind(this));

    // View enabled/disabled toggles
    document.getElementById("top-view-enabled").addEventListener("change", (e) => {
      const params = document.getElementById("top-view-params");
      if (e.target.checked) {
        params.classList.add("expanded");
      } else {
        params.classList.remove("expanded");
      }
      this.updateTotalImagesCount();
    });

    document.getElementById("middle-view-enabled").addEventListener("change", (e) => {
      const params = document.getElementById("middle-view-params");
      if (e.target.checked) {
        params.classList.add("expanded");
      } else {
        params.classList.remove("expanded");
      }
      this.updateTotalImagesCount();
    });

    document.getElementById("bottom-view-enabled").addEventListener("change", (e) => {
      const params = document.getElementById("bottom-view-params");
      if (e.target.checked) {
        params.classList.add("expanded");
      } else {
        params.classList.remove("expanded");
      }
      this.updateTotalImagesCount();
    });

    // Update total images count for all possible inputs
    const updateCountInputs = [
      "top-view-enabled",
      "middle-view-enabled",
      "bottom-view-enabled",
      "angle-top",
      "angle-middle",
      "angle-bottom",
      "dist-close",
      "dist-medium",
      "dist-far",
      "top-rotation",
      "middle-rotation",
      "bottom-rotation",
      "top-angle",
      "middle-angle",
      "bottom-angle",
    ];

    updateCountInputs.forEach((id) => {
      document.getElementById(id).addEventListener("input", this.updateTotalImagesCount.bind(this));
      document.getElementById(id).addEventListener("change", this.updateTotalImagesCount.bind(this));
    });

    // Normalization Square Controls
    document.getElementById("show-square").addEventListener("change", (e) => {
      console.log(e.target.checked);
      this.squareVisible = e.target.checked;
      this.updateNormalizationSquare();
    });

    // Initial calls
    this.updateBackgroundVisibility();
    this.updateTotalImagesCount();
    this.updateNormalizationSquare();
  }

  updateNormalizationSquare() {
    if (!this.squareVisible) {
      this.normalizationSquare.style.display = "none";
      return;
    }

    // Use a fixed size square - 80% of the minimum viewport dimension
    const minDimension = Math.min(window.innerWidth, window.innerHeight);
    const squareSize = minDimension * 0.8; // Fixed at 80% of viewport

    // Center square in viewport
    const left = (window.innerWidth - squareSize) / 2;
    const top = (window.innerHeight - squareSize) / 2;

    // Update square position and size
    this.normalizationSquare.style.display = "block";
    this.normalizationSquare.style.left = `${left}px`;
    this.normalizationSquare.style.top = `${top}px`;
    this.normalizationSquare.style.width = `${squareSize}px`;
    this.normalizationSquare.style.height = `${squareSize}px`;
  }

  updateTotalImagesCount() {
    // Check if each view is enabled and get count
    const topEnabled = document.getElementById("top-view-enabled").checked;
    const middleEnabled = document.getElementById("middle-view-enabled").checked;
    const bottomEnabled = document.getElementById("bottom-view-enabled").checked;

    const topCount = topEnabled ? parseInt(document.getElementById("angle-top").value || 0) : 0;
    const middleCount = middleEnabled ? parseInt(document.getElementById("angle-middle").value || 0) : 0;
    const bottomCount = bottomEnabled ? parseInt(document.getElementById("angle-bottom").value || 0) : 0;

    const closeChecked = document.getElementById("dist-close").checked;
    const mediumChecked = document.getElementById("dist-medium").checked;
    const farChecked = document.getElementById("dist-far").checked;

    // Count how many distance options are selected
    const distanceCount = (closeChecked ? 1 : 0) + (mediumChecked ? 1 : 0) + (farChecked ? 1 : 0);

    // Total images is angles × distances
    const totalImages = (topCount + middleCount + bottomCount) * distanceCount;

    document.getElementById("total-images-count").textContent = totalImages;
  }

  updateBackgroundVisibility() {
    const bgType = document.getElementById("bg-type").value;
    const bgColorRow = document.getElementById("bg-color-row");

    if (bgType === "color") {
      bgColorRow.style.display = "flex";
    } else {
      bgColorRow.style.display = "none";
    }
  }

  updateBackgroundPreview() {
    const bgType = document.getElementById("bg-type").value;
    const bgColor = document.getElementById("bg-color").value;

    // Apply background changes based on selected type
    if (bgType === "transparent") {
      this.renderer.alpha = true;
      this.scene.background = null;
    } else if (bgType === "color") {
      this.renderer.alpha = false;
      this.scene.background = new THREE.Color(bgColor);
    } else if (bgType === "environment") {
      this.renderer.alpha = false;
      this.scene.background = this.environmentMap;
    }

    // Force a render to update the view
    this.render();
  }

  //   loadHDR(name) {
  //     const path = this.hdrPaths[name];
  //     const rgbeLoader = new RGBELoader();

  //     rgbeLoader.load(path, (texture) => {
  //       this.environmentMap = this.pmremGenerator.fromEquirectangular(texture).texture;
  //       this.scene.environment = this.environmentMap;

  //       // If the background type is "environment", set the background
  //       if (document.getElementById("bg-type").value === "environment") {
  //         this.scene.background = this.environmentMap;
  //       }

  //       texture.dispose();
  //       this.pmremGenerator.dispose();
  //     });
  //   }

  loadHDR(name) {
    const path = this.hdrPaths[name];
    const rgbeLoader = new RGBELoader();

    rgbeLoader.load(path, (texture) => {
      this.environmentMap = this.pmremGenerator.fromEquirectangular(texture).texture;
      this.scene.environment = this.environmentMap;

      // Update background if background type is "environment"
      if (document.getElementById("bg-type").value === "environment") {
        this.scene.background = this.environmentMap;
      }

      texture.dispose();
      this.pmremGenerator.dispose();
    });
  }

  loadGLBFromArrayBuffer(buffer) {
    const loader = new GLTFLoader();

    // Set up Draco decoder
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath("https://unpkg.com/three@0.151.3/examples/jsm/libs/draco/");
    loader.setDRACOLoader(dracoLoader);

    // Remove previous model if exists
    if (this.model) {
      this.scene.remove(this.model);
    }

    loader.parse(
      buffer,
      "",
      (gltf) => {
        this.model = gltf.scene;

        // Create a group to contain the model
        this.modelGroup = new THREE.Group();
        this.scene.add(this.modelGroup);

        // Center model
        this.modelBoundingBox.setFromObject(this.model);
        this.modelBoundingBox.getCenter(this.model.position);
        this.model.position.multiplyScalar(-1);

        // Calculate dimension ratios to check for distortion
        const size = this.modelBoundingBox.getSize(new THREE.Vector3());
        const maxDimension = Math.max(size.x, size.y, size.z);
        this.modelSize = maxDimension;

        // Add model to the model group
        this.modelGroup.add(this.model);

        // Log the model dimensions for debugging
        console.log("Model dimensions:", size);

        // Reset camera to see the whole model
        this.resetCamera();

        // No need to reset reference scale since we're using the current state
      },
      undefined,
      (error) => {
        console.error("Error loading GLB:", error);
        alert("Error loading model. Please try another file.");
      }
    );
  }

  resetCamera() {
    if (!this.model) return;

    // Get the bounding box dimensions
    this.modelBoundingBox.setFromObject(this.model);
    const size = this.modelBoundingBox.getSize(new THREE.Vector3());

    // Position camera to see the whole model
    // Calculate distance based on model height and camera FOV
    const fov = this.camera.fov * (Math.PI / 180);
    const distance =
      Math.max(
        size.y / (2 * Math.tan(fov / 2)),
        size.x / (2 * Math.tan(fov / 2) * this.camera.aspect),
        size.z / (2 * Math.tan(fov / 2))
      ) * 2.5; // Multiplier to give some margin

    // Position camera more horizontally to reduce perspective distortion
    this.camera.position.set(distance, distance * 0.5, distance);
    this.camera.lookAt(0, 0, 0);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  getModelRadius() {
    if (!this.model) return 1;

    // Get the current bounding box
    this.modelBoundingBox.setFromObject(this.model);
    const size = this.modelBoundingBox.getSize(new THREE.Vector3());

    // Use the maximum dimension as the base for our radius calculation
    const maxDimension = Math.max(size.x, size.y, size.z);
    return maxDimension / 2;
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.updateNormalizationSquare();
  }

  animate() {
    requestAnimationFrame(this.animate.bind(this));
    this.controls.update();
    this.render();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  // Add this method to the ModelViewer class to get the current camera rotation
  getCurrentCameraRotation() {
    // Calculate the horizontal angle (around Y axis) of the camera
    // This is the angle in the XZ plane
    const cameraPosition = this.camera.position.clone();

    // Get the angle in radians, then convert to degrees
    const horizontalAngle = Math.atan2(cameraPosition.z, cameraPosition.x);
    const degrees = ((horizontalAngle * 180) / Math.PI) % 360;

    // Convert to 0-360 range (atan2 returns -180 to 180)
    return degrees < 0 ? degrees + 360 : degrees;
  }

  // Modify the exportImages method to use the current camera rotation as the center
  async exportImages() {
    if (!this.model) {
      alert("Please load a model first!");
      return;
    }

    // Get current camera rotation to use as the center reference for all views
    const currentRotation = this.getCurrentCameraRotation();
    console.log(`Using current camera rotation: ${currentRotation.toFixed(1)}° as center reference`);

    const bgType = document.getElementById("bg-type").value;

    // Get configuration for each view
    const viewConfigs = [];

    // Top view - use current rotation as center
    if (document.getElementById("top-view-enabled").checked) {
      const count = parseInt(document.getElementById("angle-top").value || 0);
      if (count > 0) {
        viewConfigs.push({
          name: "top",
          count: count,
          centerRotation: currentRotation, // Use current rotation as center
          rotationRange: parseInt(document.getElementById("top-rotation").value || 120), // Get rotation range from input
          viewAngleDegrees: parseInt(document.getElementById("top-angle").value || 45),
        });
      }
    }

    // Middle view - use current rotation as center
    if (document.getElementById("middle-view-enabled").checked) {
      const count = parseInt(document.getElementById("angle-middle").value || 0);
      if (count > 0) {
        viewConfigs.push({
          name: "middle",
          count: count,
          centerRotation: currentRotation, // Use current rotation as center
          rotationRange: parseInt(document.getElementById("middle-rotation").value || 120), // Get rotation range from input
          viewAngleDegrees: parseInt(document.getElementById("middle-angle").value || 90),
        });
      }
    }

    // Bottom view - use current rotation as center
    if (document.getElementById("bottom-view-enabled").checked) {
      const count = parseInt(document.getElementById("angle-bottom").value || 0);
      if (count > 0) {
        viewConfigs.push({
          name: "bottom",
          count: count,
          centerRotation: currentRotation, // Use current rotation as center
          rotationRange: parseInt(document.getElementById("bottom-rotation").value || 120), // Get rotation range from input
          viewAngleDegrees: parseInt(document.getElementById("bottom-angle").value || 135),
        });
      }
    }

    // Use checkboxes to determine which distances to use
    const useCloseDistance = document.getElementById("dist-close").checked;
    const useMediumDistance = document.getElementById("dist-medium").checked;
    const useFarDistance = document.getElementById("dist-far").checked;

    // Get current camera distance to model center as the base "close" distance
    const modelCenter = new THREE.Vector3();
    this.modelBoundingBox.setFromObject(this.model);
    this.modelBoundingBox.getCenter(modelCenter);
    const currentCameraDistance = this.camera.position.distanceTo(modelCenter);

    console.log(`Current camera distance: ${currentCameraDistance}`);

    // Use the current camera position as the "close" distance
    // and derive medium and far as multiples of this distance
    const closeDistance = currentCameraDistance;
    const mediumDistance = closeDistance * 1.75; // 1.75x further than close
    const farDistance = closeDistance * 3; // 3x further than close

    const distances = [];

    if (useCloseDistance) distances.push({ label: "close", value: closeDistance });
    if (useMediumDistance) distances.push({ label: "medium", value: mediumDistance });
    if (useFarDistance) distances.push({ label: "far", value: farDistance });

    // Calculate total export count
    const totalExports = viewConfigs.reduce((sum, config) => sum + config.count, 0) * distances.length;

    if (totalExports === 0) {
      alert("Please set at least one non-zero value for angles and select at least one distance");
      return;
    }

    // Set up for export
    const zip = new JSZip();
    const folder = zip.folder("renders");

    // Show progress container
    const progressContainer = document.getElementById("progress-container");
    const progressElement = document.getElementById("progress");
    const statusElement = document.getElementById("export-status");
    progressContainer.style.display = "block";

    // Save current camera state
    const originalCameraPosition = this.camera.position.clone();
    const originalControlsTarget = this.controls.target.clone();

    // Save current renderer state
    const originalAlpha = this.renderer.alpha;
    const originalBackground = this.scene.background;

    // Set up export renderer with square 1:1 aspect ratio
    const exportWidth = 1024;
    const exportHeight = 1024;
    this.renderer.setSize(exportWidth, exportHeight);

    // Update camera aspect to match export aspect ratio
    const originalAspect = this.camera.aspect;
    this.camera.aspect = exportWidth / exportHeight; // Square aspect ratio (1:1)
    this.camera.updateProjectionMatrix();

    // Setup for background
    if (bgType === "transparent") {
      this.renderer.alpha = true;
      this.scene.background = null;
    } else if (bgType === "color") {
      this.renderer.alpha = false;
      this.scene.background = new THREE.Color(document.getElementById("bg-color").value);
    } else if (bgType === "environment") {
      this.renderer.alpha = false;
      this.scene.background = this.environmentMap;
    }

    // Export images
    let currentExport = 0;

    // Function to update progress
    const updateProgress = () => {
      currentExport++;
      statusElement.textContent = `Processing: ${currentExport}/${totalExports}`;
      progressElement.style.width = `${(currentExport / totalExports) * 100}%`;
    };

    // Function to capture an image at specified angles and distance
    const captureImage = (viewConfig, viewIndex, distanceObj) => {
      this.resetCamera();
      return new Promise((resolve) => {
        let rotation;

        if (viewConfig.count > 1) {
          // Calculate the total angle range (e.g., 120 means from -60° to +60° from center)
          const halfRange = viewConfig.rotationRange / 2;

          // Calculate the angle offset from center for each step
          // Maps viewIndex from [0, count-1] to [-halfRange, +halfRange]
          const step = viewConfig.rotationRange / (viewConfig.count - 1);
          const angleOffset = -halfRange + viewIndex * step;

          // Final rotation is center + offset, normalized to 0-360 range
          rotation = (viewConfig.centerRotation + angleOffset) % 360;
          if (rotation < 0) rotation += 360;

          console.log(
            `Image ${viewIndex + 1}/${viewConfig.count}: Center ${viewConfig.centerRotation.toFixed(
              1
            )}° + offset ${angleOffset.toFixed(1)}° = ${rotation.toFixed(1)}°`
          );
        } else {
          // Just use the center rotation for a single image
          rotation = viewConfig.centerRotation;
          console.log(`Single image: Using center rotation ${rotation.toFixed(1)}°`);
        }

        // Convert to radians for Three.js
        const horizontalAngle = (rotation * Math.PI) / 180;

        // Convert the vertical view angle from degrees to radians
        const verticalAngle = (viewConfig.viewAngleDegrees * Math.PI) / 180;

        // Calculate camera position using spherical coordinates
        const distance = distanceObj.value;

        const x = distance * Math.sin(verticalAngle) * Math.cos(horizontalAngle);
        const y = distance * Math.cos(verticalAngle);
        const z = distance * Math.sin(verticalAngle) * Math.sin(horizontalAngle);

        // Set camera position and look at center
        this.camera.position.set(x, y, z);
        this.camera.lookAt(0, 0, 0);

        // Render
        this.renderer.render(this.scene, this.camera);

        // Get image
        const dataUrl = this.renderer.domElement.toDataURL("image/png");

        // Convert to blob
        fetch(dataUrl)
          .then((res) => res.blob())
          .then((blob) => {
            // Add to zip with filename that includes the rotation angle
            const offsetText =
              viewConfig.count > 1
                ? viewIndex === 0
                  ? "start"
                  : viewIndex === viewConfig.count - 1
                  ? "end"
                  : `${viewIndex}`
                : "center";

            const filename = `${viewConfig.name}_${offsetText}_${rotation.toFixed(0)}deg_${distanceObj.label}.png`;
            folder.file(filename, blob);

            updateProgress();
            resolve();
          });
      });
    };

    // Process all combinations of views and distances
    for (const viewConfig of viewConfigs) {
      for (let i = 0; i < viewConfig.count; i++) {
        for (const distance of distances) {
          await captureImage(viewConfig, i, distance);
        }
      }
    }

    // Restore original camera position
    this.camera.position.copy(originalCameraPosition);
    this.controls.target.copy(originalControlsTarget);
    this.controls.update();

    // Restore renderer
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.alpha = originalAlpha;
    this.scene.background = originalBackground;

    // Restore camera aspect ratio
    this.camera.aspect = originalAspect;
    this.camera.updateProjectionMatrix();

    // Generate the zip
    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, "model-renders.zip"); // Using saveAs from file-saver

    // Hide progress
    progressContainer.style.display = "none";

    // Re-render at original size
    this.render();
  }
}
