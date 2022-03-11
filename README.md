# MyLoadTest Datapool

The MyLoadTest Datapool is a self-hosted solution for shared and persistent data for load testing. Virtual users can read and write to a common pool of data, store data between tests, and avoid the administrative overhead of managing single-use data.

Note: there is a cloud-hosted version of the datapool at <https://datapool.myloadtest.com/>. The cloud-hosted datapool is API-compatible with the self-hosted version, and has additional API endpoint for reading email (useful for automating website user registrations) and receiving SMS messages.


## Table of Contents

-   [Installation](#installation)
    -   [Windows Installation](#windows-installation)
    -   [Linux Installation](#linux-installation)
-   [Datapool API](#datapool-api)
-   [Use Cases](#use-cases)
    -   [Managing consumable data](#managing-consumable-data)
    -   [Generating unique values](#generating-unique-values)
    -   [Sharing new data between vusers](#sharing-new-data-between-vusers)
    -   [Saving data for post-test verfication](#saving-data-for-post-test-verfication)
    -   [Centralised logging](#centralised-logging)
    -   [Unique logins for vusers](#unique-logins-for-vusers)


# Installation

Installation is intended to be quick and painless. Note: if you need to move the datapool to a different server and need to preserve your data, do a fresh install, but copy the *.sqlite files to the new server.


## Windows Installation

```sh
# Install software dependencies:
# -   Git Client: https://git-scm.com/download/win
# -   Node.js v16.x: https://nodejs.org/en/

# Clone the repository to a folder of your choice:
cd C:\TEMP
git clone  --depth=1 https://github.com/MyLoadTest/datapool.git
# If this step is having problems, use a web browser to check that you have access to the repository.

# Install Node module dependencies:
cd C:\TEMP\datapool\server
npm install

# Start the datapool server
npm start

# Now you can open http://localhost:3000 in your web browser
# Note: create a Windows service to have the datapool running all the time.
# See: https://www.howtogeek.com/50786/using-srvstart-to-run-any-application-as-a-windows-service/
```


## Linux Installation

```bash
# Install software dependencies
sudo apt-get update
apt get install git
apt get install nodejs # check the version number after install (should be > 16)

# Get the required files from GitHub
git clone --depth 1 https://github.com/myloadtest/datapool.git

# install the modules listed in package.json
cd datapool/server
npm install

# run ```node ./bin/www```
npm start

# now you can open http://localhost:3000 in your web browser
```


# Datapool API

The datapool has five endpoints:
-   **Counter**: A counter is a number that is incremented each time it is read.
-   **Map:** A map contains key-value pairs. The values may be a JSON object or a primitive value.
-   **Person**: A person has a name, age, gender and email address. A new person is returned on every read.
-   **Queue**: A queue is an ordered list of items. Every time the queue is read, an item is removed.
-   **User-code**: A function is user-submitted JavaScript code that may be invoked via a web service call.

Start the datapool and navigate to ```http://<servername>/api/``` to see the API documentation.


# Use Cases

There are several load testing use cases that are made easier by the datapool. These individual use-cases may be combined into actions that are performed before, during and after a load test.

1.  **Pre-test**
    -   Run a script to load version-controlled data into the data pool (e.g. user accounts)
    -   Run a script to load data from the test system's database into the datapool (e.g. all expenses with a status of "waiting for approval")
    -   Confirm that any stored consumable data is sufficient for the test volumes that will be run (exit the test if not)
2.  **During test**
    -   Read values from datapool to use as test inputs (random names, unique values, consumable data, etc.)
    -   Store values that are used to create new records (to be checked at the end of the test)
3.  **Post-test**
    -   Run a post-test verification script. Perform reconcilliation of records created (both record details and volumes).

Note: LoadRunner code examples can be found on the datapool homepage at ```http://<servername>/```.


## Managing consumable data

Example problem:
-   A web service for registering cars requires a valid Vehicle Identification Number (that must be in the system), but the VIN may only be used for one vehicle registration.

Datapool solution:
-   Export a list of valid VINs from the system-under test, insert them into a queue, and pop a new VIN from the queue each time the registration web service is called. Run as many load tests as needed until there are no more VINs in the queue.

Alternative solutions:
-   Roll-back or refresh the database after each load test.
-   Export a list of unused VINs from the system under test before running each load test.

When a test has single-use data, there is a natural impulse to want to store it in a table with a boolean "used" column. Using a table instead of a queue creates the possibility of race conditions - where two virtual users get the same value before one of them has had a chance to mark the value as used.


## Generating unique values

Example problem:
-   A web service that receives new student registrations. The 7-digit student Id must not collide with any existing students.

Datapool solution:
-   Use a Counter. Initialise it to "1000000". Get the next counter value each time a new student Id is needed.

Alternative solutions:
-   Use a millisecond timestamp (13 digits), or subtract 2022-01-01 from it to give an 8 digit value. The risk of collisions is fairly high when running a load test - two users in the same millisecond will get the same value.
-   Use a crypto library to generate a unique value (e.g 128 bits, which could be expressed as a base64 value like "d41d8cd98f00b204e9800998ecf8427e").
-   Use a crypto library to generate a UUID (in JavaScrtipt you could use ```crypto.reandomUUID()```, which returns something like "36b8f84d-df4e-4d49-b662-bcde71a8764f").

Note that the ```/person``` endpoint can be used to get random names and unique email addresses.


## Sharing new data between vusers

Example problems:
-   User A submits an expense claim, User B (with a manager role) approves the expense claim.

Datapool solution:
-   User A adds the claim Id to a queue, User B gets the next value from the queue and approves it.

Alternative solutions:
-   A vuser logs in as User A, creates an expense claim, then immediately logs in as User B to approve the same expense claim. As it is the same vuser for both business processes, there is no need to share data between vusers, but this might create an unnaturally high number of logins during the test which might alter the result.
-   Before the test, User A creates a backlog of claims and writes the claim Ids to a file (data preparation). During the test, User B reads from the file of old claim Ids and ignores any new claims that are created during the test. There is now a manual step of cutting and pasting data between tests.

This problem often occurs in cases where a business process involves "workflow", causing multiple user roles to update a record.


## Saving data for post-test verfication

Example problem:
-   Running a load test will create thousands of new records. Even if no errors were displayed to the virtual users, a race condition may have corrupted or lost some of the records. How to check that the correct number of orders (for example) were created, and that all of their details are correct.

Datapool solution:
-   When an order is created, save the data inputs to a queue. At the end of the test, run a post-test verification script to check that all the orders in the system match the list of orders that should have been created. This could be done via a web services API, or by generating a (very long) SQL query and running it against the database.

Alternative solutions:
-   Most performance testers don't bother to do any kind of checking or reconcilliation at the end of a test. They consider corrupted or lost orders a "functional" problem even if the problem will never occur during functional testing as it is due to concurrency.
-   Manually check "one or two" orders and assume that all the other ones are fine.


## Centralised logging

Example problem:
-   Some vusers are experiencing errors during a load test. Before blaming the system under test, it is important to rule out bad data, so all vusers will need to log their data inputs if they get an error.

Datapool solution:
-   Write the data to a queue, export the queue at the end of the test and try some of the failed values manually (or step through the script with those input values).

Alternative solutions:
-   Log to a separate file for each vuser (traditional logging), and check thousands of files at the end of the test.
-   Ignore the problem as "it's just a few errors".


## Unique logins for vusers

Example problem:
-   A test will run with 100,000 orders over an hour (1667 orders/minute). To prevent caching, the orders should be created with 100,000 different user accounts. The list of accounts must be evenly split between 4000 virtual users (with a pacing time of 144 seconds). Each vuser needs 25 accounts for the hour.

Datapool solution:
-   Load 100,000 accounts into a queue at the start of the test. Vusers will pop a new account from the queue on each iteration.
-   Load 100,000 accounts into a queue at the start of the test. On their first iteration each vuser will pop 25 accounts from the queue

Alternative solutions:
-   Create the orders with 4000 accounts (1 per vuser) and don't worry about caching.
-   Use a file parameter to store the usernames.

Most load testing tools have a built-in data table for file-based parameters. For example, for a UserName parameter with a "unique" property, LoadRunner will split the users.dat file and allocate separate rows to each virtual user. BUT this only works when the vusers have the same script and group.
