export const containerVariants = {
    hidden: {
        opacity: 0,
        y: 16,
    },
    visible: {
        opacity: 1,
        y: 0,
        transition: {
            type: 'easeIn',
            duration: 0.6,
        },
    },
};