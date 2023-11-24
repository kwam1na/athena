export const mainContainerVariants = {
    hidden: {
        opacity: 0,
        y: 8,
    },
    visible: {
        opacity: 1,
        y: 0,
        transition: {
            type: 'easeIn',
            duration: 0.4,
        },
    },
};

export const widgetVariants = {
    hidden: {
        opacity: 0,
    },
    visible: {
        opacity: 1,
        transition: {
            type: 'easeIn',
            duration: 0.4,
        },
    },
}

export const onboardingContainerVariants = {
    hidden: {
        opacity: 0,
        y: 16,
    },
    visible: {
        opacity: 1,
        y: 0,
        transition: {
            type: 'easeIn',
            duration: 0.4,
        },
    },
};

export const onboardingButtonVariants = {
    hidden: {
        opacity: 0,
        x: -24,
    },
    visible: {
        opacity: 1,
        x: 0,
        transition: {
            type: 'easeIn',
            duration: 0.5,
            delay: 0.6,
        },
    },
};

export const onboardingBlurbVariants = {
    hidden: {
        opacity: 0,
        y: 8,
    },
    visible: {
        opacity: 1,
        y: 0,
        transition: {
            type: 'easeIn',
            duration: 0.4,
            delay: 0.6,
        },
    },
};