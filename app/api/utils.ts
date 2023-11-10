export const generateSKU = (category: string, subcategory: string, counter: number) => {
    const categoryCode = category.slice(0, 3).toUpperCase();
    const subcategoryCode = subcategory.slice(0, 3).toUpperCase();

    return `${categoryCode}-${subcategoryCode}-${counter}`;
};

