import json
import random

# 1. Real-world Data Seed
CATEGORIES = {
    "Smartphones": {
        "brands": {
            "Apple": ["iPhone SE", "iPhone 13", "iPhone 14", "iPhone 15", "iPhone 15 Pro", "iPhone 16"],
            "Samsung": ["Galaxy A54", "Galaxy S23", "Galaxy S24", "Galaxy Z Fold 5", "Galaxy Z Flip 5"],
            "Google": ["Pixel 7a", "Pixel 8", "Pixel 8 Pro", "Pixel Fold"]
        },
        "specs": lambda: {
            "processor": random.choice(["Snapdragon 8 Gen 3", "Apple A17 Pro", "Google Tensor G3", "MediaTek Dimensity 9300"]),
            "ramGb": random.choice([6, 8, 12, 16]),
            "storageGb": random.choice([128, 256, 512, 1024]),
            "display": f"{random.choice([6.1, 6.4, 6.7, 6.8])}-inch OLED",
            "refreshRateHz": random.choice([60, 90, 120, 144]),
            "batteryMah": random.choice([4000, 4500, 5000]),
            "network": "5G",
            "os": random.choice(["iOS 17", "Android 14"])
        }
    },
    "Laptops": {
        "brands": {
            "Dell": ["XPS 13", "XPS 15", "Inspiron 15", "Alienware m16"],
            "Lenovo": ["ThinkPad X1", "Yoga 7i", "Legion Pro 5", "IdeaPad 3"],
            "Apple": ["MacBook Air M2", "MacBook Air M3", "MacBook Pro 14", "MacBook Pro 16"]
        },
        "specs": lambda: {
            "processor": random.choice(["Intel Core i7-13700H", "AMD Ryzen 9 7940HS", "Apple M3 Pro"]),
            "ramGb": random.choice([8, 16, 32, 64]),
            "storageGb": random.choice([256, 512, 1024, 2048]),
            "storageType": "NVMe SSD",
            "gpu": random.choice(["Integrated", "RTX 4060", "RTX 4080", "Apple 18-core GPU"]),
            "screenSize": random.choice([13.3, 14.0, 15.6, 16.0]),
            "os": random.choice(["Windows 11 Home", "Windows 11 Pro", "macOS Sonoma"])
        }
    }
    # Add more categories (Tablets, TVs, Routers, etc.) following this structure
}

COLORS = ["Black", "White", "Silver", "Graphite", "Blue", "Green"]
TARGET_TOTAL_PRODUCTS = 50000
PRODUCTS_PER_FILE = 10000

def generate_catalog():
    generated_skus = set()
    products = []
    file_index = 1
    
    while len(products) < TARGET_TOTAL_PRODUCTS:
        category = random.choice(list(CATEGORIES.keys()))
        brand = random.choice(list(CATEGORIES[category]["brands"].keys()))
        model = random.choice(CATEGORIES[category]["brands"][brand])
        
        # Generate 1 to 4 variants for this model
        num_variants = random.randint(1, 4)
        variants = []
        
        for i in range(num_variants):
            color = random.choice(COLORS)
            specs = CATEGORIES[category]["specs"]()
            
            # Create a unique SKU
            base_sku = f"{brand[:3].upper()}-{model.replace(' ', '').upper()}-{specs.get('storageGb', 'STD')}-{color[:3].upper()}"
            sku = base_sku
            counter = 1
            while sku in generated_skus:
                sku = f"{base_sku}-{counter}"
                counter += 1
            
            generated_skus.add(sku)
            
            variants.append({
                "variantName": f"{brand} {model} {specs.get('storageGb', '')}GB {color}",
                "sku": sku,
                "displayOrder": i + 1,
                "specifications": specs
            })
            
        product = {
            "categoryName": category,
            "brandName": brand,
            "modelName": model,
            "description": f"High-quality {category.lower()} from {brand}, featuring the latest specs for optimal performance.",
            "variants": variants
        }
        
        products.append(product)
        
        # Chunking logic
        if len(products) >= PRODUCTS_PER_FILE:
            save_file(products, file_index)
            products = []
            file_index += 1

    # Save any remaining products
    if products:
        save_file(products, file_index)
        def save_file(data, index):
    filename = f"catalogue_part_{index:03d}.json"
    with open(filename, "w") as f:
        json.dump({"products": data}, f, indent=2)
    print(f"Saved {filename} with {len(data)} products.")

if name == "main":
    generate_catalog()
    print("Catalog generation complete!")