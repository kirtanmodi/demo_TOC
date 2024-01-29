const AWS = require('aws-sdk');
const { corsConfig } = require('./helpers');

AWS.config.update({ region: process.env.AWS_REGION || 'us-east-2' });

const cognito = new AWS.CognitoIdentityServiceProvider();

module.exports.handler = async (event) => {
    try {
        const { email, newPassword } = JSON.parse(event.body);

        const response = await cognito.adminSetUserPassword({
            UserPoolId: process.env.USER_POOL_ID,
            Username: email,
            Password: newPassword,
            Permanent: true
        }).promise();

        return {
            statusCode: 200,
            headers: corsConfig.headers,
            body: JSON.stringify(response)
        };

    } catch (error) {
        console.error('Error in changing password:', JSON.stringify(error));
        return {
            statusCode: error.statusCode || 500,
            headers: corsConfig.headers,
            body: JSON.stringify({ error: error.message || 'An unexpected error occurred.' })
        };
    }
};
